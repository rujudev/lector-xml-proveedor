// =============================================================================
// XML SYNC → SHOPIFY (Versión corregida, estable y legible)
// =============================================================================

import { XMLParser } from "fast-xml-parser";
import { sendProgressEvent } from "../routes/api.sync-events.jsx";

// =============================================================================
// CONFIG
// =============================================================================
// Agregar configuración para procesamiento paralelo
const CONFIG = {
  RATE_LIMIT_DELAY: 100,
  CACHE_ENABLED: true,
  RETRY_COUNT: 3,
  RETRY_BASE_DELAY_MS: 150,
  LOG: true,
  PARALLEL_BATCH_SIZE: 6, // Procesar hasta 6 productos simultáneamente
};

const log = (...args) => CONFIG.LOG && console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Función auxiliar para manejar respuestas GraphQL de diferentes versiones del SDK
async function parseGraphQLResponse(response) {
  if (!response) {
    throw new Error('Respuesta GraphQL vacía');
  }
  
  // Si ya tiene data directamente, devolverlo
  if (response.data !== undefined) {
    return response;
  }
  
  // Si tiene método json(), es una respuesta HTTP
  if (response.json && typeof response.json === 'function') {
    return await response.json();
  }
  
  // Si es un string, intentar parsearlo
  if (typeof response === 'string') {
    try {
      return JSON.parse(response);
    } catch (e) {
      throw new Error(`No se pudo parsear respuesta GraphQL: ${response}`);
    }
  }
  
  // Caso no esperado
  throw new Error(`Formato de respuesta GraphQL no reconocido: ${typeof response}`);
}

// Función para buscar productos existentes en Shopify
async function findExistingProductByGroup(admin, itemGroupId, firstProductSku) {
  try {
    // Buscar por múltiples criterios para máxima precisión
    const searchQueries = [
      `sku:${itemGroupId}`,                    // Por item_group_id como SKU
      `barcode:${itemGroupId}`,               // Por item_group_id como barcode
      `sku:${firstProductSku}`,               // Por SKU del primer producto
      `barcode:${firstProductSku}`            // Por barcode del primer producto
    ].filter(Boolean); // Filtrar valores nulos

    for (const searchQuery of searchQueries) {
      const query = `
        query searchProducts($query: String!) {
          products(first: 5, query: $query) {
            edges {
              node {
                id
                title
                handle
                variants(first: 50) {
                  edges {
                    node {
                      id
                      sku
                      barcode
                      price
                      inventoryQuantity
                    }
                  }
                }
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await admin.graphql(query, {
        variables: { query: searchQuery }
      });

      const result = await parseGraphQLResponse(response);
      
      if (result.data?.products?.edges?.length > 0) {
        const product = result.data.products.edges[0].node;
        log(`✅ Producto existente encontrado: ${product.title} (${product.id})`);
        return product;
      }
    }

    return null; // No encontrado
  } catch (error) {
    log(`❌ Error buscando producto existente:`, error);
    return null;
  }
}

// Función para actualizar producto existente
async function updateExistingProduct(admin, existingProduct, newVariants, sendProgressEvent) {
  try {
    log(`🔄 Actualizando producto existente: ${existingProduct.title}`);
    
    const baseVariant = newVariants[0];
    const productId = existingProduct.id;
    let updatedVariantsCount = 0;
    let createdVariantsCount = 0;

    // 1. Actualizar información base del producto
    await updateProductDetails(admin, productId, baseVariant, sendProgressEvent);

    // 2. Procesar cada variante del XML
    for (const newVariant of newVariants) {
      const existingVariant = findMatchingVariant(existingProduct.variants.edges, newVariant);
      
      if (existingVariant) {
        // Actualizar variante existente
        await updateExistingVariant(admin, existingVariant.node.id, newVariant, sendProgressEvent);
        updatedVariantsCount++;
      } else {
        // Agregar nueva variante al producto existente
        await addVariantToProduct(admin, productId, newVariant, sendProgressEvent);
        createdVariantsCount++;
      }
    }

    // 3. Procesar imágenes si hay nuevas
    await updateProductImages(admin, productId, newVariants);

    log(`✅ Producto actualizado: ${updatedVariantsCount} variantes actualizadas, ${createdVariantsCount} variantes nuevas`);
    
    return {
      productId,
      action: 'updated',
      variantsUpdated: updatedVariantsCount,
      variantsCreated: createdVariantsCount
    };

  } catch (error) {
    log(`❌ Error actualizando producto existente:`, error);
    throw error;
  }
}

// Función auxiliar para encontrar variante coincidente
function findMatchingVariant(existingVariants, newVariant) {
  return existingVariants.find(edge => {
    const existing = edge.node;
    
    // Buscar por SKU (más confiable)
    if (existing.sku && newVariant.sku && existing.sku === newVariant.sku) {
      return true;
    }
    
    // Buscar por barcode/GTIN
    if (existing.barcode && newVariant.gtin && existing.barcode === newVariant.gtin.toString()) {
      return true;
    }
    
    return false;
  });
}

// Función para actualizar detalles base del producto
async function updateProductDetails(admin, productId, baseVariant, sendProgressEvent) {
  const updateMutation = `
    mutation updateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { 
          id 
          title 
        }
        userErrors { 
          field 
          message 
        }
      }
    }
  `;

  const productInput = {
    id: productId,
    title: baseVariant.title,
    bodyHtml: baseVariant.description,
    vendor: baseVariant.brand,
    tags: baseVariant.tags
  };

  const response = await admin.graphql(updateMutation, {
    variables: { product: productInput }
  });

  const result = await parseGraphQLResponse(response);
  
  if (result.data?.productUpdate?.userErrors?.length > 0) {
    throw new Error(`Error actualizando producto: ${JSON.stringify(result.data.productUpdate.userErrors)}`);
  }

  if (sendProgressEvent) {
    await sendProgressEvent('updated', `Actualizado producto: ${baseVariant.title}`);
  }
}

// Función para actualizar variante existente
async function updateExistingVariant(admin, variantId, newVariant, sendProgressEvent) {
  const updateMutation = `
    mutation updateProductVariant($productVariant: ProductVariantUpdateInput!) {
      productVariantUpdate(productVariant: $productVariant) {
        productVariant { 
          id 
          sku 
          price 
        }
        userErrors { 
          field 
          message 
        }
      }
    }
  `;

  const variantInput = {
    id: variantId,
    price: parseFloat(newVariant.price).toFixed(2),
    sku: newVariant.sku,
    inventoryPolicy: "CONTINUE"
  };

  // Agregar barcode si está disponible
  if (newVariant.gtin && /^[0-9]{8,}$/.test(newVariant.gtin.toString())) {
    variantInput.barcode = newVariant.gtin.toString();
  }

  const response = await admin.graphql(updateMutation, {
    variables: { productVariant: variantInput }
  });

  const result = await parseGraphQLResponse(response);
  
  if (result.data?.productVariantUpdate?.userErrors?.length > 0) {
    log(`⚠️ Error actualizando variante: ${JSON.stringify(result.data.productVariantUpdate.userErrors)}`);
  }

  if (sendProgressEvent) {
    await sendProgressEvent('updated', `Actualizada variante: ${newVariant.sku}`);
  }
}

// Función para agregar nueva variante a producto existente
async function addVariantToProduct(admin, productId, newVariant, sendProgressEvent) {
  const createMutation = `
    mutation createProductVariant($productVariant: ProductVariantCreateInput!) {
      productVariantCreate(productVariant: $productVariant) {
        productVariant { 
          id 
          sku 
          price 
        }
        userErrors { 
          field 
          message 
        }
      }
    }
  `;

  // Generar opciones para la nueva variante
  const sizeMatch = newVariant.title?.match(/(\d+(?:GB|TB|ML|L))/i);
  const capacityValue = sizeMatch ? sizeMatch[1] : "Estándar";
  
  const CONDITIONS = {
    "new": "Nuevo",
    "refurbished": "Reacondicionado", 
    "used": "Usado"
  };
  const conditionValue = CONDITIONS[newVariant.condition] || "Nuevo";

  const variantInput = {
    productId: productId,
    price: parseFloat(newVariant.price).toFixed(2),
    sku: newVariant.sku,
    inventoryPolicy: "CONTINUE",
    optionValues: [
      { optionName: "Capacidad", name: capacityValue },
      { optionName: "Condición", name: conditionValue }
    ]
  };

  // Agregar barcode si está disponible  
  if (newVariant.gtin && /^[0-9]{8,}$/.test(newVariant.gtin.toString())) {
    variantInput.barcode = newVariant.gtin.toString();
  }

  const response = await admin.graphql(createMutation, {
    variables: { productVariant: variantInput }
  });

  const result = await parseGraphQLResponse(response);
  
  if (result.data?.productVariantCreate?.userErrors?.length > 0) {
    log(`⚠️ Error creando nueva variante: ${JSON.stringify(result.data.productVariantCreate.userErrors)}`);
  }

  if (sendProgressEvent) {
    await sendProgressEvent('created', `Nueva variante: ${newVariant.sku}`);
  }
}

// Función para actualizar imágenes del producto
async function updateProductImages(admin, productId, variants) {
  // Obtener imágenes únicas de todas las variantes
  const imageUrls = [...new Set(
    variants
      .map(v => v.image_link)
      .filter(Boolean)
  )];

  if (imageUrls.length === 0) return;

  for (const imageUrl of imageUrls) {
    try {
      const mediaMutation = `
        mutation createMedia($media: [CreateMediaInput!]!, $productId: ID!) {
          productCreateMedia(media: $media, productId: $productId) {
            media {
              id
              status
            }
            mediaUserErrors {
              field
              message
            }
          }
        }
      `;

      const response = await admin.graphql(mediaMutation, {
        variables: {
          productId: productId,
          media: [{
            originalSource: imageUrl,
            mediaContentType: "IMAGE"
          }]
        }
      });

      const result = await parseGraphQLResponse(response);
      
      if (result.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
        log(`⚠️ Error agregando imagen: ${JSON.stringify(result.data.productCreateMedia.mediaUserErrors)}`);
      }
      
      await sleep(100); // Rate limiting
    } catch (error) {
      log(`⚠️ Error procesando imagen ${imageUrl}:`, error);
    }
  }
}

async function withRetry(fn, retries = CONFIG.RETRY_COUNT) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) throw err;
      const delay = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log(`⚠️ Retry ${attempt}/${retries} after ${delay}ms - ${err.message}`);
      await sleep(delay);
    }
  }
}

// =============================================================================
// XML PARSE + NORMALIZATION
// =============================================================================

function mapAvailability(av) {
  const a = av?.toLowerCase();
  if (a === "in_stock" || a === "available")
    return { status: "active", inventoryPolicy: "CONTINUE" };

  if (a === "preorder" || a === "coming_soon" || a === "new")
    return { status: "active", inventoryPolicy: "CONTINUE", tags: ["preorder"] };

  return { status: "draft", inventoryPolicy: "DENY" };
}

function parseXmlProduct(item) {
  const availabilityInfo = mapAvailability(item["g:availability"]);

  // ============================================
  // SKU: prioridad → GTIN > MPN > g:id
  // ============================================
  const sku =
    item["g:gtin"] ||
    item["g:mpn"] ||
    item["g:id"] ||
    null;

  // ============================================
  // TAGS
  // ============================================
  const tags = [];

  // Tags de disponibilidad (preorder)
  if (availabilityInfo.tags) tags.push(...availabilityInfo.tags);

  // Marca
  if (item["g:brand"]) tags.push(item["g:brand"]);

  // Condición → etiquetas normalizadas
  const condition = item["g:condition"]?.toLowerCase();
  if (condition) {
    // tag original
    tags.push(condition);

    // tags traducidos
    switch (condition) {
      case "new":
        tags.push("nuevo");
        break;
      case "refurbished":
        tags.push("reacondicionado");
        break;
      case "used":
        tags.push("usado");
        break;
    }
  }

  // Grupo de variantes
  if (item["g:item_group_id"]) tags.push(`group:${item["g:item_group_id"]}`);

  // Categoría
  if (item["g:product_type"]) tags.push(item["g:product_type"]);

  // ============================================
  // Producto normalizado
  // ============================================
  return {
    id: item["g:id"] || null,
    title: item["g:title"] || "Producto sin título",
    description: item["g:description"] || "",
    vendor: item["g:brand"] || "Proveedor",
    brand: item["g:brand"] || "",
    condition: item["g:condition"] || "",
    price: parseFloat(item["g:price"]?.replace(/[^\d.]/g, "")) || 0,
    gtin: item["g:gtin"] || null,
    sku,
    item_group_id: item["g:item_group_id"] || null,
    image_link: item["g:image_link"] || null,
    availability: item["g:availability"] || "unknown",
    color: item["g:color"] || "",
    category: item["g:product_type"] || "",
    tags,
    status: availabilityInfo.status,
    inventoryPolicy: availabilityInfo.inventoryPolicy,
  };
}


// =============================================================================
// SHOPIFY QUERIES
// =============================================================================
const FIND_PRODUCT_QUERY = `
  query findProduct($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          vendor
          tags
          description
          variants(first: 50) {
            edges { 
              node { 
                id 
                sku 
                barcode 
                price 
              } 
            }
          }
          images(first: 10) {
            edges { 
              node { 
                url
                altText 
              } 
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_CREATE = `
  mutation createProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { 
        id 
        title 
        handle 
        variants(first: 10) {
          edges {
            node {
              id
              sku
              barcode
              price
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation updateProduct($id: ID!, $input: ProductInput!) {
    productUpdate(id: $id, input: $input) {
      product { id title handle }
      userErrors { field message }
    }
  }
`;

const VARIANT_UPDATE_INDIVIDUAL = `
  mutation updateProductVariant($productVariant: ProductVariantUpdateInput!) {
    productVariantUpdate(productVariant: $productVariant) {
      productVariant { 
        id 
        sku 
        barcode 
        price 
      }
      userErrors { field message }
    }
  }
`;

const VARIANT_CREATE_INDIVIDUAL = `
  mutation createProductVariant($productVariant: ProductVariantCreateInput!) {
    productVariantCreate(productVariant: $productVariant) {
      productVariant {
        id
        title
        sku
        barcode
        price
        selectedOptions {
          name
          value
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `
  mutation productCreateMedia($media: [CreateMediaInput!]!, $productId: ID!) {
    productCreateMedia(media: $media, productId: $productId) {
      media {
        alt
        mediaContentType
        status
      }
      mediaUserErrors {
        field
        message
      }
      product {
        id
        title
      }
    }
  }
`;

const PRODUCT_SET = `
  mutation productSet($input: ProductSetInput!) {
    productSet(input: $input) {
      product {
        id
        title
        handle
        vendor
        status
        variants(first: 50) {
          edges {
            node {
              id
              title
              sku
              barcode
              price
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
      userErrors { 
        field 
        message 
      }
    }
  }
`;

// =============================================================================
// VARIANT GROUPING AND IMAGE HANDLING
// =============================================================================

/**
 * Agrupa productos por item_group_id para identificar variantes
 * @param {Array} products - Lista de productos parseados del XML
 * @returns {Map} - Mapa con clave=item_group_id, valor=array de productos
 */
function groupProductsByVariants(products) {
  const groups = new Map();
  const standalone = [];
  
  for (const product of products) {
    if (product.item_group_id) {
      if (!groups.has(product.item_group_id)) {
        groups.set(product.item_group_id, []);
      }
      groups.get(product.item_group_id).push(product);
    } else {
      standalone.push(product);
    }
  }
  
  // Agregar productos independientes como grupos de 1
  standalone.forEach(product => {
    groups.set(`standalone_${product.id}`, [product]);
  });
  
  if (CONFIG.LOG) {
    log(`📊 Grupos de variantes encontrados: ${groups.size}`);
    log(`📦 Productos con variantes: ${[...groups.values()].reduce((acc, group) => acc + group.length, 0)}`);
  }
  
  return groups;
}

/**
 * Determina qué producto debe ser el "maestro" de un grupo de variantes
 * @param {Array} variants - Lista de variantes del mismo grupo
 * @returns {Object} - El producto que servirá como base
 */
function selectMasterProduct(variants) {
  // Criterios de prioridad:
  // 1. Producto con menor precio (más atractivo)
  // 2. Producto "in_stock" sobre "out_of_stock"
  // 3. Primer producto alfabéticamente por título
  
  return variants.sort((a, b) => {
    // 1. Prioridad por disponibilidad
    if (a.availability === "in_stock" && b.availability !== "in_stock") return -1;
    if (b.availability === "in_stock" && a.availability !== "in_stock") return 1;
    
    // 2. Prioridad por precio (menor precio primero)
    if (a.price !== b.price) return a.price - b.price;
    
    // 3. Orden alfabético por título
    return a.title.localeCompare(b.title);
  })[0];
}

/**
 * Crea input de medios para Shopify desde URLs de imágenes
 * @param {Array} variants - Lista de variantes con sus imágenes
 * @returns {Array} - Array de CreateMediaInput válidos según la API oficial
 */
function createMediaInput(variants) {
  const mediaList = [];
  const seenImages = new Set();
  
  for (const variant of variants) {
    if (variant.image_link && !seenImages.has(variant.image_link)) {
      seenImages.add(variant.image_link);
      
      // Validar que la URL sea válida
      try {
        new URL(variant.image_link);
        
        mediaList.push({
          originalSource: variant.image_link,  // Campo oficial de la API
          alt: `${variant.title} - ${variant.color || 'Imagen del producto'}`.slice(0, 120), // Limitar longitud
          mediaContentType: "IMAGE"
        });
      } catch (error) {
        log(`⚠️ URL de imagen inválida ignorada: ${variant.image_link}`);
      }
    }
  }
  
  if (CONFIG.LOG && mediaList.length > 0) {
    log(`🖼️ ${mediaList.length} imágenes preparadas para el producto`);
  }
  
  return mediaList;
}

/**
 * Agrega imágenes a un producto existente usando productCreateMedia
 * @param {Object} admin - Cliente admin de Shopify
 * @param {string} productId - ID del producto 
 * @param {Array} variants - Lista de variantes con imágenes
 * @returns {Object} - Resultado de la operación
 */
async function addProductImages(admin, productId, variants) {
  const mediaInput = createMediaInput(variants);
  
  if (mediaInput.length === 0) {
    return { success: true, message: "No hay imágenes que agregar" };
  }

  if (CONFIG.LOG) {
    log(`🖼️ Agregando ${mediaInput.length} imágenes al producto ${productId}`);
  }

  try {
    const rawResponse = await withRetry(() =>
      admin.graphql(PRODUCT_CREATE_MEDIA, {
        variables: {
          productId: productId,
          media: mediaInput
        }
      })
    );

    const responseData = await parseGraphQLResponse(rawResponse);
    
    const errors = responseData?.data?.productCreateMedia?.mediaUserErrors || [];
    if (errors.length) {
      log(`❌ Error agregando imágenes:`, errors);
      return { success: false, error: errors };
    }

    const addedMedia = responseData?.data?.productCreateMedia?.media || [];
    
    if (CONFIG.LOG) {
      log(`✅ ${addedMedia.length} imágenes agregadas exitosamente`);
    }

    return { success: true, media: addedMedia };
    
  } catch (error) {
    log(`💥 Error agregando imágenes: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Crea opciones de producto basadas en las diferencias entre variantes
 * @param {Array} variants - Lista de variantes del mismo grupo
 * @returns {Array} - Array de opciones para ProductCreateInput
 */
function createProductOptions(variants) {
  const options = [];
  const colorSet = new Set();
  const sizeSet = new Set();
  const conditionSet = new Set();
  
  // Extraer valores únicos de las variantes
  variants.forEach(variant => {
    if (variant.color) colorSet.add(variant.color);
    
    // Extraer capacidad/tamaño del título (ej: "256GB", "512GB")
    const sizeMatch = variant.title.match(/(\d+(?:GB|TB|ML|L))/i);
    if (sizeMatch) {
      sizeSet.add(sizeMatch[1]);
    } else {
      // Si no se encuentra capacidad en el título, usar un valor por defecto
      sizeSet.add("Estándar");
    }
    
    if (variant.condition) {
      conditionSet.add(variant.condition);
    } else {
      // Si no hay condición, usar "new" por defecto
      conditionSet.add("new");
    }
  });
  
  // Crear opciones solo si hay variación para el color
  if (colorSet.size > 1) {
    options.push({
      name: "Color",
      values: Array.from(colorSet).map(color => ({ name: color }))
    });
  }
  
  // SIEMPRE incluir Capacidad (obligatorio)
  options.push({
    name: "Capacidad", 
    values: Array.from(sizeSet).map(size => ({ name: size }))
  });
  
  // SIEMPRE incluir Condición (obligatorio)
  const CONDITIONS_DISPLAY = {
    "new": "Nuevo",
    "refurbished": "Reacondicionado", 
    "used": "Usado"
  };
  
  options.push({
    name: "Condición",
    values: Array.from(conditionSet).map(condition => ({ 
      name: CONDITIONS_DISPLAY[condition] || condition 
    }))
  });
  
  if (CONFIG.LOG && options.length > 0) {
    log(`🎯 ${options.length} opciones de producto creadas:`, options.map(o => `${o.name} (${o.values.length} valores)`));
  }
  
  return options;
}

// =============================================================================
// SHOPIFY SEARCH QUERY BUILDER
// =============================================================================

function sanitize(value) {
  if (!value) return "";
  return value
    .toString()
    .replace(/["'\n\r\t]+/g, " ") // elimina comillas y saltos de línea
    .replace(/\s+/g, " ")         // normaliza espacios
    .trim();
}

function buildSearchQuery(p) {
  // Construir query siguiendo la documentación oficial de Shopify API
  // Campos válidos para productos: title, vendor, tag, product_type, status, created_at, updated_at
  // Los campos sku y barcode NO son directamente searchables en products
  
  // Prioridad 1: Buscar por vendor + título (más específico)
  if (p.vendor && p.vendor.trim() && p.title && p.title.trim()) {
    const cleanVendor = sanitize(p.vendor);
    const cleanTitle = sanitize(p.title);
    
    if (cleanVendor.length > 2 && cleanTitle.length > 3) {
      const query = `vendor:${cleanVendor} title:${cleanTitle}`;
      if (CONFIG.LOG) {
        log(`🔍 Query construida por vendor+título: ${query}`);
      }
      return query;
    }
  }
  
  // Prioridad 2: Buscar solo por vendor (si es específico y sin espacios)
  if (p.vendor && p.vendor.trim()) {
    const cleanVendor = sanitize(p.vendor);
    if (cleanVendor.length > 3 && !cleanVendor.includes(' ')) {
      const query = `vendor:${cleanVendor}`;
      if (CONFIG.LOG) {
        log(`🔍 Query construida por vendor: ${query}`);
      }
      return query;
    }
  }

  // Prioridad 3: Buscar por título (si es específico)
  if (p.title && p.title.trim()) {
    const cleanTitle = sanitize(p.title);
    if (cleanTitle.length > 5) {
      // Usar solo las primeras palabras del título para evitar búsquedas demasiado específicas
      const titleWords = cleanTitle.split(' ').slice(0, 3).join(' ');
      const query = `title:${titleWords}`;
      if (CONFIG.LOG) {
        log(`🔍 Query construida por título: ${query}`);
      }
      return query;
    }
  }

  // Si no hay criterios válidos, no buscar
  if (CONFIG.LOG) {
    log(`⚠️ No se pudo construir query válida para: ${p.title || 'producto sin título'}`);
  }
  return null;
}

// =============================================================================
// PRODUCT SEARCH
// =============================================================================

async function findExistingProduct(admin, p, cache) {
  try {
    const query = buildSearchQuery(p);
    if (!query) {
      if (CONFIG.LOG) {
        log(`⚠️ No se pudo construir query válida para: ${p.title || 'producto sin título'}`);
      }
      return null;
    }
    
    if (CONFIG.CACHE_ENABLED && cache.has(query)) {
      if (CONFIG.LOG) {
        log(`💾 Cache hit para query: "${query}"`);
      }
      return cache.get(query);
    }
    
    if (CONFIG.LOG) {
      log(`🔍 Ejecutando búsqueda GraphQL: "${query}"`);
      log(`📊 Variables enviadas:`, { query: query, first: 5 });
    }
    
    // CORREGIDO: Pasar variables correctamente al GraphQL
    const rawResponse = await withRetry(() => admin.graphql(FIND_PRODUCT_QUERY, {
      variables: { 
        query: query, 
        first: 5 
      }
    }));
    
    // Parsear respuesta usando función auxiliar
    const data = await parseGraphQLResponse(rawResponse);
    
    // Verificar errores en la respuesta
    if (!data || data.errors) {
      if (CONFIG.LOG) {
        log(`❌ Error en respuesta GraphQL:`, data?.errors || 'No data');
      }
      return null;
    }
    
    const products = data.products?.edges || [];
    
    if (products.length > 0) {
      const foundProduct = products[0].node;
      if (CONFIG.CACHE_ENABLED) {
        cache.set(query, foundProduct);
      }
      if (CONFIG.LOG) {
        log(`✅ Producto existente encontrado: ${foundProduct.title} (ID: ${foundProduct.id})`);
      }
      return foundProduct;
    }
    
    if (CONFIG.CACHE_ENABLED) {
      cache.set(query, null);
    }
    
    if (CONFIG.LOG) {
      log(`❌ No se encontraron productos para: "${query}"`);
    }
    return null;
    
  } catch (error) {
    if (CONFIG.LOG) {
      log(`💥 Excepción en búsqueda: ${error.message}`);
      
      // Log adicional para debug
      if (error.response) {
        log(`� Detalles del error:`, error.response);
      }
      if (error.networkError) {
        log(`🌐 Error de red:`, error.networkError);
      }
      if (error.graphQLErrors) {
        log(`📝 Errores GraphQL:`, error.graphQLErrors);
      }
    }
    
    // En caso de error, tratar como producto nuevo
    return null;
  }
}

// =============================================================================
// PRODUCT CREATION WITH VARIANTS
// =============================================================================

async function createShopifyProductWithVariants(admin, variants) {
  const masterProduct = selectMasterProduct(variants);
  const productOptions = createProductOptions(variants);
  
  // Preparar datos del producto base
  const title = sanitize(masterProduct.title) || "Producto sin título";
  const vendor = sanitize(masterProduct.vendor) || "Sin marca";
  const description = sanitize(masterProduct.description) || "";
  
  // Validar precio
  const price = parseFloat(masterProduct.price);
  if (isNaN(price) || price <= 0) {
    log(`❌ Precio inválido para ${title}: ${masterProduct.price}`);
    return { success: false, error: "Precio inválido" };
  }
  
  // ProductCreateInput con opciones y medios
  const productInput = {
    title: title,
    vendor: vendor,
    descriptionHtml: description,
    status: "ACTIVE",
    productType: sanitize(masterProduct.category) || "",
  };
  
  // Agregar opciones si hay variantes múltiples
  if (productOptions.length > 0) {
    productInput.productOptions = productOptions;
  }
  
  // Tags: combinar tags de todas las variantes
  const allTags = new Set();
  variants.forEach(variant => {
    if (variant.tags) {
      variant.tags.forEach(tag => allTags.add(sanitize(tag)));
    }
  });
  
  if (allTags.size > 0) {
    productInput.tags = Array.from(allTags).filter(tag => tag && tag.length > 0);
  }
  
  if (CONFIG.LOG) {
    log(`🔧 Creando producto con ${variants.length} variantes: ${title}`);
  }
  
  try {
    // Paso 1: Crear producto base
    const rawResponse = await withRetry(() =>
      admin.graphql(PRODUCT_CREATE, {
        variables: { 
          product: productInput
        }
      })
    );

    // Parsear respuesta usando función auxiliar
    const responseData = await parseGraphQLResponse(rawResponse);

    const errors = responseData?.data?.productCreate?.userErrors || [];
    if (errors.length) {
      log(`❌ Error creando producto ${title}:`, errors);
      return { success: false, error: errors.map(e => e.message).join("; ") };
    }

    const createdProduct = responseData?.data?.productCreate?.product;
    if (!createdProduct || !createdProduct.id) {
      log(`❌ No se pudo crear el producto ${title}`);
      log(`🔍 responseData completo (variants):`, JSON.stringify(responseData, null, 2));
      return { success: false, error: "No se pudo crear el producto" };
    }

    log(`✅ Producto base creado: ${createdProduct.title} (ID: ${createdProduct.id})`);

    // Paso 2: Agregar imágenes al producto
    const imagesResult = await addProductImages(admin, createdProduct.id, variants);
    if (!imagesResult.success) {
      log(`⚠️ Error agregando imágenes: ${imagesResult.error}`);
    }

    // Paso 3: Si hay múltiples variantes, establecer todas las variantes de una vez
    if (variants.length > 1) {
      const variantsResult = await createProductVariants(admin, createdProduct, variants);
      if (!variantsResult.success) {
        log(`⚠️ Error estableciendo variantes, pero producto base creado: ${variantsResult.error}`);
      } else {
        if (CONFIG.LOG) {
          log(`✅ ${variants.length} variantes establecidas correctamente con SKUs`);
        }
      }
    } else {
      // Para productos únicos, solo actualizar la variante por defecto
      if (createdProduct.variants?.edges?.length > 0) {
        const defaultVariant = createdProduct.variants.edges[0].node;
        await updateDefaultVariant(admin, defaultVariant.id, masterProduct, createdProduct.id);
      }
    }

    return { success: true, product: createdProduct };
  } catch (error) {
    log(`💥 Excepción creando producto ${title}:`, error.message);
    return { success: false, error: error.message };
  }
}

function variantExists(product, variant) {
  return product.variants?.edges.some(edge => {
    const existing = edge.node;
    // Comparar opciones
    if (!existing.selectedOptions) return false;

    return variant.optionValues.every(opt => 
      existing.selectedOptions.some(eo => eo.name === opt.optionName && eo.value === opt.name)
    );
  });
}

async function createProductVariants(admin, product, variants) {
  try {
    // Preparar variantes para bulk create (excluir la primera que ya existe)
    const variantsInput = variants.slice(1).map(variant => {
      console.log('@@@ variante', variant);

      // --- Opciones base: incluir siempre Capacidad y Condición ---
      const productOptions = product.options?.map(o => o.name) || [];
      const optionValues = [];

      // Color (solo si existe en las opciones del producto)
      if (variant.color && productOptions.includes("Color")) {
        optionValues.push({ optionName: "Color", name: variant.color });
      }

      // Capacidad (SIEMPRE incluir)
      const sizeMatch = variant.title.match(/(\d+(?:GB|TB|ML|L))/i);
      const capacityValue = sizeMatch ? sizeMatch[1] : "Estándar";
      optionValues.push({ optionName: "Capacidad", name: capacityValue });

      // Condición (SIEMPRE incluir)
      const CONDITIONS = {
        "new": "Nuevo",
        "refurbished": "Reacondicionado",
        "used": "Usado"
      };
      const conditionValue = variant.condition ? 
        (CONDITIONS[variant.condition] || variant.condition) : 
        "Nuevo";
      optionValues.push({ optionName: "Condición", name: conditionValue });

      if (variantExists(product, { optionValues })) {
        log(`⚠️ Variante ya existe: ${optionValues.map(o => o.name).join(" / ")}`);
        return null;
      }

      // --- Construir objeto variante SIN SKU (ProductVariantsBulkInput no lo soporta) ---
      const variantInput = {
        price: parseFloat(variant.price).toFixed(2), // siempre string con decimales
        inventoryPolicy: variant.inventoryPolicy || "CONTINUE",
      };

      // Barcode (GTIN)
      if (variant.gtin && /^[0-9]{8,}$/.test(variant.gtin.toString())) {
        variantInput.barcode = variant.gtin.toString();
      }

      // Opciones (siempre incluir al menos Capacidad y Condición)
      variantInput.optionValues = optionValues;

      // Imagen con estructura CreateMediaInput
      if (variant.image_link) {
        try {
          new URL(variant.image_link);
          variantInput.media = [{
            originalSource: variant.image_link,
            alt: `${variant.title} - ${variant.color || 'Imagen del producto'}`.slice(0, 120),
            mediaContentType: "IMAGE"
          }];
        } catch (error) {
          log(`⚠️ URL de imagen inválida ignorada para variante: ${variant.image_link}`);
        }
      }

      // Guardar el SKU para asignarlo después de la creación
      variantInput._pendingSku = variant.sku;

      return variantInput;
    });

    if (variantsInput.length === 0) {
      return { success: true }; // No hay variantes adicionales que crear
    }

    if (CONFIG.LOG) {
      log(`🎯 Creando ${variantsInput.length} variantes adicionales`);
    }

    // --- Ejecutar Set de Variantes (incluye la variante por defecto + nuevas) ---
    const allVariants = [];
    const masterVariant = variants[0]; // Primer elemento como variante principal
    
    // Incluir variante por defecto con datos completos
    const masterVariantInput = {
      price: parseFloat(masterVariant.price).toFixed(2),
      inventoryPolicy: masterVariant.inventoryPolicy || "CONTINUE",
      sku: masterVariant.sku ? sanitize(masterVariant.sku.toString()) : undefined,
      barcode: masterVariant.gtin && /^[0-9]{8,}$/.test(masterVariant.gtin.toString()) 
        ? masterVariant.gtin.toString() 
        : undefined,
      optionValues: []
    };
    
    // Generar opciones para la variante principal
    const sizeMatch = masterVariant.title?.match(/(\d+(?:GB|TB|ML|L))/i);
    const capacityValue = sizeMatch ? sizeMatch[1] : "Estándar";
    masterVariantInput.optionValues.push({ optionName: "Capacidad", name: capacityValue });
    
    const CONDITIONS = { "new": "Nuevo", "refurbished": "Reacondicionado", "used": "Usado" };
    const conditionValue = CONDITIONS[masterVariant.condition] || "Nuevo";
    masterVariantInput.optionValues.push({ optionName: "Condición", name: conditionValue });
    
    if (masterVariant.color) {
      masterVariantInput.optionValues.push({ optionName: "Color", name: masterVariant.color });
    }
    
    if (masterVariant.image_link) {
      try {
        new URL(masterVariant.image_link);
        masterVariantInput.media = [{
          originalSource: masterVariant.image_link,
          alt: `${masterVariant.title} - ${masterVariant.color || 'Imagen del producto'}`.slice(0, 120),
          mediaContentType: "IMAGE"
        }];
      } catch (error) {
        log(`⚠️ URL de imagen inválida ignorada para variante principal: ${masterVariant.image_link}`);
      }
    }
    
    allVariants.push(masterVariantInput);
    
    // Agregar variantes adicionales (omitir la primera que ya incluimos)
    allVariants.push(...variantsInput.map(variant => ({
      price: variant.price,
      inventoryPolicy: variant.inventoryPolicy,
      sku: variant._pendingSku ? sanitize(variant._pendingSku.toString()) : undefined,
      barcode: variant.barcode,
      optionValues: variant.optionValues,
      media: variant.media
    })));

    // Preparar el input para productSet usando ProductVariantSetInput
    const productSetInput = {
      id: product.id,
      variants: allVariants.map(variant => ({
        price: variant.price,
        inventoryPolicy: variant.inventoryPolicy,
        sku: variant.sku,
        barcode: variant.barcode,
        optionValues: variant.optionValues,
        media: variant.media
      }))
    };

    const rawResponse = await withRetry(() =>
      admin.graphql(PRODUCT_SET, {
        variables: {
          input: productSetInput
        }
      })
    );

    const responseData = await parseGraphQLResponse(rawResponse);

    const errors = responseData?.data?.productSet?.userErrors || [];
    if (errors.length) {
      log(`❌ Error estableciendo variantes:`, errors);
      return { success: false, error: errors };
    }

    const updatedProduct = responseData?.data?.productSet?.product || {};
    const createdVariants = updatedProduct.variants?.edges?.map(edge => edge.node) || [];
    
    if (CONFIG.LOG) {
      log(`✅ ${createdVariants.length} variantes establecidas exitosamente con SKUs`);
    }

    return { success: true, variants: createdVariants };
    
  } catch (error) {
    log(`💥 Error creando variantes: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// PRODUCT CREATION (Original - for single products)
// =============================================================================

async function createShopifyProduct(admin, p) {
  // Validar y limpiar datos según especificaciones de Shopify API
  const title = sanitize(p.title) || "Producto sin título";
  const vendor = sanitize(p.vendor) || "Sin marca";
  const description = sanitize(p.description) || "";
  
  // Validar precio
  const price = parseFloat(p.price);
  if (isNaN(price) || price <= 0) {
    log(`❌ Precio inválido para ${title}: ${p.price}`);
    return { success: false, error: "Precio inválido" };
  }
  
  // CORREGIDO: ProductCreateInput siguiendo documentación oficial exacta
  const productInput = {
    title: title,
    vendor: vendor,
    descriptionHtml: description,
    status: "ACTIVE", // Enum válido: ACTIVE | ARCHIVED | DRAFT | UNLISTED
    productType: sanitize(p.category) || "", // Campo correcto
  };
  
  // Tags: debe ser array de strings
  const tagsArray = (p.tags || [])
    .filter(Boolean)
    .map(tag => sanitize(tag))
    .filter(tag => tag && tag.length > 0);
    
  if (tagsArray.length > 0) {
    productInput.tags = tagsArray;
  }
  
  if (CONFIG.LOG) {
    log(`🔧 ProductCreateInput válido para ${title}:`, JSON.stringify(productInput, null, 2));
  }
  
  try {
    // Paso 1: Crear producto básico con variables correctas
    const rawResponse = await withRetry(() =>
      admin.graphql(PRODUCT_CREATE, { 
        variables: { 
          product: productInput 
        } 
      })
    );

    // Parsear respuesta usando función auxiliar
    const responseData = await parseGraphQLResponse(rawResponse);

    const errors = responseData?.data?.productCreate?.userErrors || [];
    if (errors.length) {
      log(`❌ Error creando producto ${title}:`, errors);
      return { success: false, error: errors.map(e => e.message).join("; ") };
    }

    const createdProduct = responseData?.data?.productCreate?.product;
    if (!createdProduct || !createdProduct.id) {
      log(`❌ No se pudo crear el producto ${title}`);
      log(`🔍 responseData completo:`, JSON.stringify(responseData, null, 2));
      return { success: false, error: "No se pudo crear el producto" };
    }

    log(`✅ Producto base creado: ${createdProduct.title} (ID: ${createdProduct.id})`);

    // Paso 2: Agregar imágenes al producto
    const imagesResult = await addProductImages(admin, createdProduct.id, [p]);
    if (!imagesResult.success) {
      log(`⚠️ Error agregando imágenes: ${imagesResult.error}`);
    }

    // Paso 3: Actualizar la variante por defecto con nuestros datos
    if (createdProduct.variants?.edges?.length > 0) {
      const defaultVariant = createdProduct.variants.edges[0].node;
      await updateDefaultVariant(admin, defaultVariant.id, p, createdProduct.id);
    }

    return { success: true, product: createdProduct };
  } catch (error) {
    log(`💥 Excepción creando producto ${title}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Función auxiliar para actualizar la variante por defecto
async function updateDefaultVariant(admin, variantId, p, productId = null) {
  try {
    // Generar SKU único (GTIN > MPN > g:id)
    const sku = p.gtin || p.mpn || p['g:id'];
    
    // Si no tenemos productId, lo extraemos del variantId
    let actualProductId = productId;
    if (!actualProductId && variantId) {
      // El variantId tiene formato: "gid://shopify/ProductVariant/123"
      // Necesitamos el productId, que podemos obtener consultando la variante
      const variantQuery = `
        query getVariant($id: ID!) {
          productVariant(id: $id) {
            product {
              id
            }
          }
        }
      `;
      
      const variantResponse = await admin.graphql(variantQuery, {
        variables: { id: variantId }
      });
      
      const variantData = await parseGraphQLResponse(variantResponse);
      actualProductId = variantData?.data?.productVariant?.product?.id;
      
      if (!actualProductId) {
        log(`❌ No se pudo obtener productId para variante ${variantId}`);
        return;
      }
    }
    
    const variantInput = {
      id: variantId,
      price: parseFloat(p.price).toString(),
      sku: sku, // SKU único para cada variante
    };
    
    // Barcode: solo números y mínimo 8 dígitos
    if (p.gtin && /^[0-9]{8,}$/.test(p.gtin.toString())) {
      variantInput.barcode = p.gtin.toString();
    }
    
    // InventoryPolicy: usar valor válido del enum
    variantInput.inventoryPolicy = "DENY";
    
    // Opciones obligatorias: Capacidad y Condición
    const optionValues = [];
    
    // Capacidad (extraer del título o usar "Estándar")
    const sizeMatch = p.title?.match(/(\d+(?:GB|TB|ML|L))/i);
    const capacityValue = sizeMatch ? sizeMatch[1] : "Estándar";
    optionValues.push({ optionName: "Capacidad", name: capacityValue });
    
    // Condición (mapear o usar "Nuevo")
    const CONDITIONS = {
      "new": "Nuevo",
      "refurbished": "Reacondicionado",
      "used": "Usado"
    };
    const conditionValue = p.condition ? 
      (CONDITIONS[p.condition] || p.condition) : 
      "Nuevo";
    optionValues.push({ optionName: "Condición", name: conditionValue });
    
    // Color (solo si existe)
    if (p.color) {
      optionValues.push({ optionName: "Color", name: p.color });
    }
    
    // Incluir opciones en la variante
    variantInput.optionValues = optionValues;
    
    if (CONFIG.LOG) {
      log(`🔧 Actualizando variante ${variantId}:`, variantInput);
    }
    
    const rawResponse = await withRetry(() =>
      admin.graphql(VARIANT_UPDATE_INDIVIDUAL, { 
        variables: { 
          productVariant: variantInput  // Nota: productVariant, no productId + variants
        } 
      })
    );
    
    const responseData = await parseGraphQLResponse(rawResponse);
    
    const errors = responseData?.data?.productVariantUpdate?.userErrors || [];
    if (errors.length) {
      log(`❌ Error actualizando variante:`, errors);
    } else {
      log(`✅ Variante actualizada correctamente`);
    }
    
  } catch (error) {
    log(`💥 Error actualizando variante: ${error.message}`);
  }
}

// =============================================================================
// PRODUCT UPDATE
// =============================================================================

async function updateShopifyProduct(admin, existing, p) {
  const input = {
    title: p.title,
    vendor: p.vendor,
    bodyHtml: p.description,
    status: p.status,
    tags: Array.from(
      new Set([...(existing.tags || "").split(", "), ...(p.tags || [])])
    ).join(", "),
  };

  const rawResponse = await withRetry(() =>
    admin.graphql(PRODUCT_UPDATE, { 
      variables: { 
        id: existing.id, 
        input: input 
      } 
    })
  );

  const responseData = await parseGraphQLResponse(rawResponse);
  
  const errs = responseData?.data?.productUpdate?.userErrors || [];
  if (errs.length) return { success: false };

  // Agregar imágenes al producto actualizado
  const imagesResult = await addProductImages(admin, existing.id, [p]);
  if (!imagesResult.success) {
    log(`⚠️ Error agregando imágenes durante actualización: ${imagesResult.error}`);
  }

  const variant = existing.variants?.edges?.[0]?.node;
  if (variant) {
    const vInput = { id: variant.id };
    if (p.price && p.price.toString() !== variant.price) vInput.price = p.price.toString();
    if (p.sku && p.sku !== variant.sku) vInput.sku = p.sku;
    if (p.gtin && p.gtin !== variant.barcode) vInput.barcode = p.gtin;

    if (Object.keys(vInput).length > 1) { // Más que solo id
      const rawResponse2 = await withRetry(() =>
        admin.graphql(VARIANT_UPDATE_INDIVIDUAL, { 
          variables: { 
            productVariant: vInput  // Nota: productVariant, no productId + variants
          } 
        })
      );
      
      const responseData2 = await parseGraphQLResponse(rawResponse2);
      const errs2 = responseData2?.data?.productVariantUpdate?.userErrors || [];
      if (errs2.length) return { success: false };
    }
  }

  return { success: true };
}

// =============================================================================
// PROCESSING FUNCTIONS - SINGLE GROUP
// =============================================================================

/**
 * Procesa un solo grupo de variantes
 * @param {Object} admin - Cliente admin de Shopify
 * @param {string} groupId - ID del grupo
 * @param {Array} variants - Lista de variantes del grupo
 * @param {Map} cache - Cache para evitar búsquedas duplicadas
 * @param {string} shop - Dominio de la tienda para eventos
 * @param {Object} globalStats - Estadísticas globales compartidas
 * @returns {Object} - Resultado del procesamiento
 */
async function processVariantGroup(admin, groupId, variants, cache, shop, globalStats) {
  try {
    const isVariantGroup = variants.length > 1;
    const masterProduct = isVariantGroup ? selectMasterProduct(variants) : variants[0];
    
    if (CONFIG.LOG && isVariantGroup) {
      log(`🔄 Procesando grupo de variantes ${groupId}: ${variants.length} variantes`);
    }
    
    // Enviar evento de procesamiento actual
    if (shop) {
      await sendProgressEvent(shop, {
        type: "processing",
        productTitle: masterProduct.title,
        processed: globalStats.processed,
        total: globalStats.total,
        variants: isVariantGroup ? variants.length : 1,
        currentStep: isVariantGroup ? `Procesando variantes (${variants.length})` : "Procesando producto"
      });
    }
    
    // Buscar si el producto ya existe usando item_group_id
    const firstVariantSku = variants[0].sku;
    const existing = await findExistingProductByGroup(admin, groupId, firstVariantSku);
    
    let result;
    if (existing) {
      // Actualizar producto existente con nuevas variantes
      const sendProgressFn = shop ? (type, message) => sendProgressEvent(shop, { type, message }) : null;
      result = await updateExistingProduct(admin, existing, variants, sendProgressFn);
      
      if (result) {
        // Enviar evento de actualización
        if (shop) {
          await sendProgressEvent(shop, {
            type: "updated",
            productTitle: masterProduct.title,
            productId: existing.id,
            processed: globalStats.processed + 1,
            total: globalStats.total,
            variants: variants.length,
            variantsUpdated: result.variantsUpdated || 0,
            variantsCreated: result.variantsCreated || 0
          });
        }
        
        // Actualizar estadísticas
        globalStats.updated++;
        globalStats.variantsUpdated += result.variantsUpdated || 0;
        globalStats.variantsCreated += result.variantsCreated || 0;
        
        return { 
          success: true, 
          action: 'updated', 
          variants: variants.length,
          variantsUpdated: result.variantsUpdated || 0,
          variantsCreated: result.variantsCreated || 0
        };
      }
    } else {
      // Crear nuevo producto
      if (isVariantGroup) {
        // Crear producto con múltiples variantes
        result = await createShopifyProductWithVariants(admin, variants);
        if (result.success) {
          
          // Enviar evento de creación con variantes
          if (shop) {
            await sendProgressEvent(shop, {
              type: "created",
              productTitle: masterProduct.title,
              productId: result.product?.id,
              processed: globalStats.processed + 1,
              total: globalStats.total,
              variants: variants.length,
              variantDetails: variants.map(v => ({ title: v.title, price: v.price, color: v.color }))
            });
          }
          
          // Actualizar estadísticas
          globalStats.created++;
          globalStats.variantsCreated += variants.length;
          
          return { success: true, action: 'created', variants: variants.length };
        }
      } else {
        // Crear producto simple
        result = await createShopifyProduct(admin, masterProduct);
        if (result.success) {
          
          // Enviar evento de creación simple
          if (shop) {
            await sendProgressEvent(shop, {
              type: "created",
              productTitle: masterProduct.title,
              productId: result.product?.id,
              processed: globalStats.processed + 1,
              total: globalStats.total,
              variants: 1
            });
          }
          
          // Actualizar estadísticas
          globalStats.created++;
          globalStats.variantsCreated += 1;
          
          return { success: true, action: 'created', variants: 1 };
        }
      }
    }
    
    if (!result.success) {
      if (CONFIG.LOG) {
        log(`❌ Error procesando grupo ${groupId}: ${result.error}`);
      }
      
      // Enviar evento de error
      if (shop) {
        await sendProgressEvent(shop, {
          type: "error",
          productTitle: masterProduct.title,
          processed: globalStats.processed + 1,
          total: globalStats.total,
          error: result.error,
          variants: isVariantGroup ? variants.length : 1
        });
      }
      
      return { success: false, error: result.error };
    }

  } catch (err) {
    log(`❌ Error procesando grupo ${groupId}: ${err.message}`);
    
    // Enviar evento de error de excepción
    if (shop) {
      await sendProgressEvent(shop, {
        type: "error",
        productTitle: "Error de procesamiento",
        processed: globalStats.processed + 1,
        total: globalStats.total,
        error: err.message
      });
    }
    
    return { success: false, error: err.message };
  }
}

// =============================================================================
// MAIN PROCESSOR WITH VARIANTS SUPPORT (ORIGINAL)
// =============================================================================

export async function processProductsWithDuplicateCheck(admin, products, shop) {
  const stats = { created: 0, updated: 0, errors: 0, processed: 0, variants: 0 };
  const cache = new Map();
  
  // Paso 1: Agrupar productos por variantes
  const variantGroups = groupProductsByVariants(products);
  
  if (CONFIG.LOG) {
    log(`🚀 Procesando ${variantGroups.size} grupos de productos`);
  }

  // Enviar evento de inicio de sincronización
  if (shop) {
    await sendProgressEvent(shop, {
      type: "sync_started",
      message: "Iniciando sincronización de productos",
      totalItems: variantGroups.size,
      startTime: new Date().toISOString()
    });
  }

  for (const [groupId, variants] of variantGroups) {
    try {
      // Determinar si es un grupo de variantes o producto único
      const isVariantGroup = variants.length > 1;
      const masterProduct = isVariantGroup ? selectMasterProduct(variants) : variants[0];
      
      if (CONFIG.LOG && isVariantGroup) {
        log(`🔄 Procesando grupo de variantes ${groupId}: ${variants.length} variantes`);
      }
      
      // Enviar evento de procesamiento actual
      if (shop) {
        await sendProgressEvent(shop, {
          type: "processing",
          productTitle: masterProduct.title,
          processed: stats.processed,
          total: variantGroups.size,
          variants: isVariantGroup ? variants.length : 1,
          currentStep: isVariantGroup ? `Procesando variantes (${variants.length})` : "Procesando producto"
        });
      }
      
      // Buscar si el producto ya existe (usar producto maestro para búsqueda)
      const existing = await findExistingProduct(admin, masterProduct, cache);
      
      let result;
      if (existing) {
        // Actualizar producto existente (por ahora solo el principal)
        result = await updateShopifyProduct(admin, existing, masterProduct);
        if (result.success) {
          stats.updated++;
          
          // Enviar evento de actualización
          if (shop) {
            await sendProgressEvent(shop, {
              type: "updated",
              productTitle: masterProduct.title,
              productId: existing.id,
              processed: stats.processed + 1,
              total: variantGroups.size,
              variants: isVariantGroup ? variants.length : 1
            });
          }
        }
      } else {
        // Crear nuevo producto
        if (isVariantGroup) {
          // Crear producto con múltiples variantes
          result = await createShopifyProductWithVariants(admin, variants);
          if (result.success) {
            stats.created++;
            stats.variants += variants.length;
            
            // Enviar evento de creación con variantes
            if (shop) {
              await sendProgressEvent(shop, {
                type: "created",
                productTitle: masterProduct.title,
                productId: result.product?.id,
                processed: stats.processed + 1,
                total: variantGroups.size,
                variants: variants.length,
                variantDetails: variants.map(v => ({ title: v.title, price: v.price, color: v.color }))
              });
            }
          }
        } else {
          // Crear producto simple
          result = await createShopifyProduct(admin, masterProduct);
          if (result.success) {
            stats.created++;
            
            // Enviar evento de creación simple
            if (shop) {
              await sendProgressEvent(shop, {
                type: "created",
                productTitle: masterProduct.title,
                productId: result.product?.id,
                processed: stats.processed + 1,
                total: variantGroups.size,
                variants: 1
              });
            }
          }
        }
      }
      
      if (!result.success) {
        stats.errors++;
        if (CONFIG.LOG) {
          log(`❌ Error procesando grupo ${groupId}: ${result.error}`);
        }
        
        // Enviar evento de error
        if (shop) {
          await sendProgressEvent(shop, {
            type: "error",
            productTitle: masterProduct.title,
            processed: stats.processed + 1,
            total: variantGroups.size,
            error: result.error,
            variants: isVariantGroup ? variants.length : 1
          });
        }
      }

      stats.processed++;

      await sleep(CONFIG.RATE_LIMIT_DELAY);
    } catch (err) {
      stats.errors++;
      log(`❌ Error procesando grupo ${groupId}: ${err.message}`);
      
      // Enviar evento de error de excepción
      if (shop) {
        await sendProgressEvent(shop, {
          type: "error",
          productTitle: "Error de procesamiento",
          processed: stats.processed + 1,
          total: variantGroups.size,
          error: err.message
        });
      }
    }
  }

  // Estadísticas finales
  const finalStats = {
    ...stats,
    totalVariantGroups: variantGroups.size,
    totalProducts: products.length,
  };

  // Enviar evento de finalización
  if (shop) {
    await sendProgressEvent(shop, {
      type: "sync_completed",
      message: "Sincronización completada",
      stats: finalStats,
      endTime: new Date().toISOString()
    });
  }

  log("✅ Sincronización finalizada:", finalStats);
  return finalStats;
}

// =============================================================================
// OPTIMIZED PARALLEL PROCESSOR
// =============================================================================

/**
 * Versión optimizada con procesamiento paralelo de hasta 6 productos simultáneos
 * @param {Object} admin - Cliente admin de Shopify  
 * @param {Array} products - Lista de productos a procesar
 * @param {string} shop - Dominio de la tienda para eventos
 * @returns {Object} - Estadísticas finales
 */
export async function processProductsParallel(admin, products, shop) {
  const stats = { created: 0, updated: 0, errors: 0, processed: 0, variants: 0 };
  const cache = new Map();
  
  // Paso 1: Agrupar productos por variantes
  const variantGroups = groupProductsByVariants(products);
  const groupEntries = Array.from(variantGroups.entries());
  
  if (CONFIG.LOG) {
    log(`🚀 [PARALLEL] Procesando ${variantGroups.size} grupos con lotes de ${CONFIG.PARALLEL_BATCH_SIZE}`);
  }

  // Enviar evento de inicio de sincronización
  if (shop) {
    await sendProgressEvent(shop, {
      type: "sync_started",
      message: `Iniciando sincronización paralela (lotes de ${CONFIG.PARALLEL_BATCH_SIZE})`,
      totalItems: variantGroups.size,
      startTime: new Date().toISOString()
    });
  }

  // Estadísticas globales compartidas para eventos
  const globalStats = { 
    processed: 0, 
    total: variantGroups.size,
    created: 0,
    updated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    errors: 0
  };

  // Procesar en lotes paralelos
  for (let i = 0; i < groupEntries.length; i += CONFIG.PARALLEL_BATCH_SIZE) {
    const batch = groupEntries.slice(i, i + CONFIG.PARALLEL_BATCH_SIZE);
    
    if (CONFIG.LOG) {
      log(`📦 [PARALLEL] Procesando lote ${Math.floor(i / CONFIG.PARALLEL_BATCH_SIZE) + 1}/${Math.ceil(groupEntries.length / CONFIG.PARALLEL_BATCH_SIZE)} (${batch.length} grupos)`);
    }

    // Procesar el lote en paralelo
    const batchPromises = batch.map(async ([groupId, variants]) => {
      return processVariantGroup(admin, groupId, variants, cache, shop, globalStats);
    });

    try {
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Procesar resultados del lote
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const [groupId] = batch[j];
        
        globalStats.processed++;
        stats.processed++;
        
        if (result.status === 'fulfilled' && result.value.success) {
          const action = result.value.action;
          if (action === 'created') {
            stats.created++;
            stats.variants += result.value.variants;
          } else if (action === 'updated') {
            stats.updated++;
          }
        } else {
          stats.errors++;
          const error = result.status === 'rejected' ? result.reason?.message : result.value?.error;
          if (CONFIG.LOG) {
            log(`❌ [PARALLEL] Error en grupo ${groupId}: ${error}`);
          }
        }
      }

      // Pequeña pausa entre lotes para evitar sobrecarga
      if (i + CONFIG.PARALLEL_BATCH_SIZE < groupEntries.length) {
        await sleep(CONFIG.RATE_LIMIT_DELAY);
      }
      
    } catch (batchError) {
      log(`❌ [PARALLEL] Error procesando lote: ${batchError.message}`);
      stats.errors += batch.length;
    }
  }

  // Estadísticas finales combinando datos de stats y globalStats
  const finalStats = {
    created: globalStats.created || 0,
    updated: globalStats.updated || 0,
    errors: globalStats.errors || stats.errors || 0,
    processed: globalStats.processed || stats.processed || 0,
    variants: globalStats.variantsCreated + globalStats.variantsUpdated || stats.variants || 0,
    variantsCreated: globalStats.variantsCreated || 0,
    variantsUpdated: globalStats.variantsUpdated || 0,
    totalVariantGroups: variantGroups.size,
    totalProducts: products.length,
    processingMode: 'parallel',
    batchSize: CONFIG.PARALLEL_BATCH_SIZE
  };

  // Enviar evento de finalización
  if (shop) {
    await sendProgressEvent(shop, {
      type: "sync_completed",
      message: `Sincronización paralela completada (lotes de ${CONFIG.PARALLEL_BATCH_SIZE})`,
      stats: finalStats,
      endTime: new Date().toISOString()
    });
  }

  log("✅ [PARALLEL] Sincronización finalizada:", finalStats);
  return finalStats;
}

// =============================================================================
// XML FROM URL → PARSE + OPTIONAL SYNC
// =============================================================================

export async function parseXMLData(xmlUrl, admin, shop) {
  log(`🌐 Descargando XML: ${xmlUrl}`);
  const res = await fetch(xmlUrl);
  if (!res.ok) throw new Error(`XML error: ${res.status}`);

  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const items = parsed?.rss?.channel?.item || [];
  if (!items.length) {
    log("⚠️ XML vacío");
    return [];
  }

  const products = items.map(parseXmlProduct);
  log(`📦 Productos parseados: ${products.length}`);

  // Mostrar estadísticas de variantes
  const variantGroups = groupProductsByVariants(products);
  const variantStats = {
    totalProducts: products.length,
    variantGroups: variantGroups.size,
    singleProducts: [...variantGroups.values()].filter(group => group.length === 1).length,
    multiVariantGroups: [...variantGroups.values()].filter(group => group.length > 1).length,
  };
  log(`📊 Estadísticas de variantes:`, variantStats);

  if (!admin) return products;

  return await processProductsWithDuplicateCheck(admin, products, shop);
}

/**
 * @deprecated Use parseXMLData instead - this function doesn't support variants or images
 * Mantener solo para compatibilidad con código legacy
 */
export async function parseXMLOnly(xmlUrl) {
  log(`🌐 parseXMLOnly: ${xmlUrl}`);
  const res = await fetch(xmlUrl);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const items = parsed?.rss?.channel?.item || [];
  return items.map(parseXmlProduct);
}

export default { parseXMLData, processProductsWithDuplicateCheck, processProductsParallel };
