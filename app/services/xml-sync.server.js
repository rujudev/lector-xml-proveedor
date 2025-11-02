// /app/services/xml-sync.server.js
import { XMLParser } from "fast-xml-parser";
import { prisma } from "../db.server.js";

// Configuración de logging
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn', 
  INFO: 'info',
  DEBUG: 'debug'
};

const currentLogLevel = process.env.NODE_ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

function log(level, message, data = null) {
  const logLevelOrder = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };
  
  if (logLevelOrder[level] <= logLevelOrder[currentLogLevel]) {
    if (data && typeof data === 'object') {
      console[level](`[XML-SYNC] ${message}`, JSON.stringify(data, null, 2));
    } else if (data) {
      console[level](`[XML-SYNC] ${message}`, data);
    } else {
      console[level](`[XML-SYNC] ${message}`);
    }
  }
}

// Wrapper para GraphQL que maneja errores de forma limpia
async function safeGraphQLCall(admin, query, variables, operationName = 'GraphQL') {
  try {
    const response = await admin.graphql(query, { variables });
    const responseJson = await response.json();
    
    // Si hay errores de GraphQL, los manejamos sin imprimir el response completo
    if (responseJson.errors && responseJson.errors.length > 0) {
      const errorMessages = responseJson.errors.map(e => e.message);
      log(LOG_LEVELS.ERROR, `${operationName} GraphQL errors`, errorMessages);
      
      return {
        success: false,
        errors: responseJson.errors,
        data: null
      };
    }
    
    return {
      success: true,
      errors: [],
      data: responseJson.data
    };
    
  } catch (error) {
    log(LOG_LEVELS.ERROR, `${operationName} failed`, error.message);
    return {
      success: false,
      errors: [{ message: error.message }],
      data: null
    };
  }
}

// Configuración del parser XML
const xmlParserConfig = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  trimValues: true,
  removeNSPrefix: true, // Importante: esto elimina los prefijos de namespace como g:
  parseTagValue: false,
};

// Función para parsear productos del XML (reutilizada)
export function parseProductsFromXML(xmlContent) {
  const parser = new XMLParser(xmlParserConfig);

  try {
    const result = parser.parse(xmlContent);
    let products = [];
    
    log(LOG_LEVELS.DEBUG, 'Estructura del XML parseado', Object.keys(result));
    
    // Detectar diferentes formatos de XML comunes
    if (result.products && result.products.product) {
      products = Array.isArray(result.products.product) 
        ? result.products.product 
        : [result.products.product];
    } else if (result.catalog && result.catalog.item) {
      products = Array.isArray(result.catalog.item) 
        ? result.catalog.item 
        : [result.catalog.item];
    } else if (result.rss && result.rss.channel && result.rss.channel.item) {
      products = Array.isArray(result.rss.channel.item) 
        ? result.rss.channel.item 
        : [result.rss.channel.item];
    } else if (result.feed && result.feed.entry) {
      // Google Shopping Feed format
      products = Array.isArray(result.feed.entry) 
        ? result.feed.entry 
        : [result.feed.entry];
    } else if (result.channel && result.channel.item) {
      // RSS format directo
      products = Array.isArray(result.channel.item) 
        ? result.channel.item 
        : [result.channel.item];
    } else if (result.item) {
      // Items directos (tu formato)
      products = Array.isArray(result.item) 
        ? result.item 
        : [result.item];
    } else if (result.product) {
      products = Array.isArray(result.product) 
        ? result.product 
        : [result.product];
    } else {
      // Buscar en todas las propiedades del objeto raíz
      for (const [key, value] of Object.entries(result)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          log(LOG_LEVELS.INFO, `Encontrados productos en: ${key}`);
          products = value;
          break;
        } else if (typeof value === 'object' && value !== null) {
          // Buscar dentro de objetos anidados
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            if (Array.isArray(nestedValue) && nestedValue.length > 0 && typeof nestedValue[0] === 'object') {
              log(LOG_LEVELS.INFO, `Encontrados productos en: ${key}.${nestedKey}`);
              products = nestedValue;
              break;
            }
          }
          if (products.length > 0) break;
        }
      }
    }

    return products.map((product, index) => {
      // Debug: mostrar estructura de un producto
      if (index === 0) {
        log(LOG_LEVELS.DEBUG, 'Estructura del primer producto', Object.keys(product));
      }

      // Extraer precio (considerando sale_price si está disponible)
      let price = 0;
      const priceText = product.sale_price || product.price || product.cost || product.amount || '0';
      if (typeof priceText === 'string') {
        // Extraer número del string "179.00 EUR" -> 179.00
        const priceMatch = priceText.match(/[\d.]+/);
        price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      } else {
        price = parseFloat(priceText) || 0;
      }

      return {
        // Google Shopping format: g:id se convierte en 'id' después del removeNSPrefix
        id: product.id || product["@_id"] || product.gtin || product.sku || `product-${index}`,
        title: product.title || product.name || product.description || `Producto ${index + 1}`,
        body_html: product.description || product.summary || product.title || '',
        price: price,
        sku: product.sku || product.id || product.gtin || product.code || null,
        vendor: product.brand || product.vendor || product.manufacturer || 'Proveedor XML',
        product_type: product.category || product.type || product.productType || 'General',
        tags: extractTags(product),
        images: extractImages(product),
        variants: extractVariants(product),
        // Campos adicionales específicos del formato Google Shopping
        condition: product.condition || 'new',
        availability: product.availability || 'in_stock',
        color: product.color || null,
        gtin: product.gtin || null,
        link: product.link || null,
        // Campos adicionales para tracking
        rawData: product, // Guardamos el producto original para comparaciones
      };
    });
  } catch (error) {
    throw new Error(`Error al parsear XML: ${error.message}`);
  }
}

// Funciones auxiliares actualizadas para Google Shopping format
export function extractImages(product) {
  const images = [];
  
  // Google Shopping format: image_link
  if (product.image_link) {
    images.push({ src: product.image_link });
  }
  
  // Formatos tradicionales
  if (product.image) {
    const imageUrls = Array.isArray(product.image) ? { src: product.image} : [{src: product.image}];
    images.push(...imageUrls);
  }
  
  if (product.images && product.images.image) {
    const imageUrls = Array.isArray(product.images.image) ? {src: product.images.image} : [{src: product.images.image}];
    images.push(...imageUrls);
  }
  
  // Filtrar URLs válidas
  return images.filter(img => typeof img === 'string' && img.startsWith('http'));
}

export function extractTags(product) {
  const tags = [];
  
  // Añadir campos como tags
  if (product.brand) tags.push(product.brand);
  if (product.color) tags.push(product.color);
  if (product.condition) tags.push(product.condition);
  if (product.category) tags.push(product.category);
  
  // Tags tradicionales
  if (product.tags) {
    if (Array.isArray(product.tags)) {
      tags.push(...product.tags);
    } else {
      tags.push(product.tags);
    }
  }
  
  if (product.categories) {
    if (Array.isArray(product.categories)) {
      tags.push(...product.categories);
    } else {
      tags.push(product.categories);
    }
  }
  
  return [...new Set(tags)]; // Eliminar duplicados
}

export function extractVariants(product) {
  if (product.variants && product.variants.variant) {
    const variants = Array.isArray(product.variants.variant) 
      ? product.variants.variant 
      : [product.variants.variant];
    
    return variants.map(variant => ({
      price: parseFloat(variant.price || product.price || '0') || 0,
      sku: variant.sku || variant.id || null,
      inventory: parseInt(variant.inventory || variant.stock || '0') || 0,
      option1: variant.size || variant.color || variant.option1 || null,
      option2: variant.color || variant.material || variant.option2 || null,
    }));
  }
  
  // Para Google Shopping format, crear una variante básica
  let price = 0;
  const priceText = product.sale_price || product.price || product.cost || '0';
  if (typeof priceText === 'string') {
    const priceMatch = priceText.match(/[\d.]+/);
    price = priceMatch ? parseFloat(priceMatch[0]) : 0;
  } else {
    price = parseFloat(priceText) || 0;
  }

  // Determinar stock basado en availability
  let inventory = 0;
  if (product.availability === 'in_stock') {
    inventory = 99; // Stock por defecto para productos disponibles
  } else if (product.availability === 'out_of_stock') {
    inventory = 0;
  } else if (product.inventory || product.stock) {
    inventory = parseInt(product.inventory || product.stock || '0') || 0;
  }
  
  return [{
    price: price,
    sku: product.gtin || product.sku || product.id || null,
    inventory: inventory,
    option1: product.color || null,
    option2: product.condition || null,
  }];
}

// Función para sincronizar un proveedor específico
export async function syncProvider(admin, providerId) {
  const syncStart = new Date();
  let syncLog;

  try {
    // Obtener información del proveedor
    const provider = await prisma.xmlProvider.findUnique({
      where: { id: providerId },
      include: { products: true }
    });

    if (!provider || !provider.isActive) {
      throw new Error("Proveedor no encontrado o inactivo");
    }

    // Crear log de sincronización
    syncLog = await prisma.syncLog.create({
      data: {
        providerId,
        status: 'running',
        startedAt: syncStart,
      }
    });

    // Descargar XML
    const response = await fetch(provider.xmlUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'User-Agent': 'Lector-XML-Proveedor/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status} ${response.statusText}`);
    }

    const xmlContent = await response.text();
    const parsedProducts = parseProductsFromXML(xmlContent);

    // Mapear productos existentes por XML ID
    const existingProducts = new Map(
      provider.products.map(p => [p.xmlProductId, p])
    );

    // Crear Set de IDs de productos del XML actual
    const currentXmlProductIds = new Set(parsedProducts.map(p => p.id));

    const results = {
      created: [],
      updated: [],
      deleted: [],
      errors: []
    };

    // Procesar cada producto
    for (const xmlProduct of parsedProducts.slice(0, 20)) { // Límite de 20 productos por sync
      try {
        const existingProduct = existingProducts.get(xmlProduct.id);

        if (existingProduct) {
          // ACTUALIZAR producto existente
          const updateResult = await updateShopifyProduct(admin, existingProduct, xmlProduct);
          if (updateResult.success) {
            results.updated.push(updateResult.product);
            
            // Actualizar mapping en BD
            await prisma.productMapping.update({
              where: { id: existingProduct.id },
              data: {
                title: xmlProduct.title,
                lastPrice: xmlProduct.price,
                lastUpdated: new Date(),
                lastSeenInXml: new Date(),
              }
            });
          } else {
            results.errors.push({ product: xmlProduct.title, error: updateResult.error });
          }
        } else {
          // CREAR nuevo producto
          const createResult = await createShopifyProduct(admin, xmlProduct);
          if (createResult.success) {
            results.created.push(createResult.product);
            
            // Crear mapping en BD
            await prisma.productMapping.create({
              data: {
                providerId,
                xmlProductId: xmlProduct.id,
                xmlSku: xmlProduct.sku,
                shopifyProductId: createResult.product.id,
                shopifyHandle: createResult.product.handle,
                title: xmlProduct.title,
                lastPrice: xmlProduct.price,
                lastSeenInXml: new Date(),
              }
            });
          } else {
            results.errors.push({ product: xmlProduct.title, error: createResult.error });
          }
        }
      } catch (error) {
        results.errors.push({ product: xmlProduct.title, error: error.message });
      }
    }

    // ELIMINAR productos que ya no están en el XML (solo si autoDelete está habilitado)
    let productsToDelete = [];
    if (provider.autoDelete) {
      productsToDelete = provider.products.filter(p => 
        p.isActive && !currentXmlProductIds.has(p.xmlProductId)
      );
    }

    for (const productToDelete of productsToDelete) {
      try {
        // Eliminar producto de Shopify
        const deleteResult = await deleteShopifyProduct(admin, productToDelete);
        if (deleteResult.success) {
          results.deleted.push({
            id: productToDelete.shopifyProductId,
            title: productToDelete.title,
            xmlProductId: productToDelete.xmlProductId
          });
          
          // Marcar como inactivo en la BD (no eliminar el registro para historial)
          await prisma.productMapping.update({
            where: { id: productToDelete.id },
            data: {
              isActive: false,
              lastUpdated: new Date(),
            }
          });
        } else {
          results.errors.push({ 
            product: productToDelete.title, 
            error: `Error al eliminar: ${deleteResult.error}` 
          });
        }
      } catch (error) {
        results.errors.push({ 
          product: productToDelete.title, 
          error: `Error al eliminar: ${error.message}` 
        });
      }
    }

    // Actualizar provider con próxima sincronización
    const nextSync = new Date(syncStart.getTime() + (provider.syncFrequency * 60 * 60 * 1000));
    await prisma.xmlProvider.update({
      where: { id: providerId },
      data: {
        lastSync: syncStart,
        nextSync: nextSync,
      }
    });

    // Finalizar log de sincronización
    const syncEnd = new Date();
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: results.errors.length === 0 ? 'success' : (results.created.length > 0 || results.updated.length > 0 || results.deleted.length > 0 ? 'partial' : 'error'),
        totalProducts: parsedProducts.length,
        productsCreated: results.created.length,
        productsUpdated: results.updated.length,
        productsDeleted: results.deleted.length,
        productsErrors: results.errors.length,
        details: JSON.stringify(results),
        completedAt: syncEnd,
        duration: Math.round((syncEnd.getTime() - syncStart.getTime()) / 1000),
      }
    });

    return {
      success: true,
      results,
      totalProducts: parsedProducts.length,
      nextSync: nextSync,
    };

  } catch (error) {
    // Actualizar log con error
    if (syncLog) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'error',
          errorMessage: error.message,
          completedAt: new Date(),
          duration: Math.round((new Date().getTime() - syncStart.getTime()) / 1000),
        }
      });
    }

    throw error;
  }
}

// Función para crear un producto en Shopify
async function createShopifyProduct(admin, xmlProduct) {
  try {
    // Crear el producto básico primero (sin variants ni images)
    const shopifyProduct = {
      title: xmlProduct.title,
      descriptionHtml: xmlProduct.description,
      vendor: xmlProduct.vendor,
      productType: xmlProduct.productType,
      tags: Array.isArray(xmlProduct.tags) ? xmlProduct.tags.join(', ') : xmlProduct.tags,
    };

    const result = await safeGraphQLCall(
      admin,
      `#graphql
      mutation productCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            # id
            title
            handle
            status
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { product: shopifyProduct },
      `Crear producto ${xmlProduct.title}`
    );

    if (!result.success) {
      return {
        success: false,
        error: result.errors.map(e => e.message).join(', ')
      };
    }
    
    if (result.data.productCreate.userErrors.length > 0) {
      log(LOG_LEVELS.WARN, `User errors para producto ${xmlProduct.title}`, result.data.productCreate.userErrors.map(e => e.message));
      return {
        success: false,
        error: result.data.productCreate.userErrors.map(e => e.message).join(', ')
      };
    }

    const createdProduct = result.data.productCreate.product;

    // Actualizar la primera variante con precio y SKU
    if (xmlProduct.variants.length > 0 && createdProduct.variants.edges.length > 0) {
      const variantId = createdProduct.variants.edges[0].node.id;
      const firstVariant = xmlProduct.variants[0];

      const variantResult = await safeGraphQLCall(
        admin,
        `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              price
              sku
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          productId: createdProduct.id,
          variants: [{
            id: variantId,
            price: firstVariant.price.toString(),
            sku: firstVariant.sku,
          }]
        },
        `Actualizar variante de ${xmlProduct.title}`
      );

      if (!variantResult.success) {
        log(LOG_LEVELS.WARN, `No se pudo actualizar la variante para ${xmlProduct.title}`, variantResult.errors.map(e => e.message));
      }
    }

    // Por ahora omitimos las imágenes para evitar complejidades con la API
    // Las imágenes se pueden añadir manualmente o en una versión futura
    if (xmlProduct.images.length > 0) {
      console.log(`Producto ${createdProduct.title} tiene ${xmlProduct.images.length} imágenes disponibles:`, xmlProduct.images.slice(0, 3));
    }

    return {
      success: true,
      product: createdProduct
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Función para actualizar un producto en Shopify
async function updateShopifyProduct(admin, existingMapping, xmlProduct) {
  try {
    // Verificar si necesita actualización (precio cambió)
    if (existingMapping.lastPrice === xmlProduct.price) {
      return {
        success: true,
        product: { id: existingMapping.shopifyProductId, title: xmlProduct.title },
        updated: false
      };
    }

    const result = await safeGraphQLCall(
      admin,
      `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        product: {
          id: existingMapping.shopifyProductId,
          title: xmlProduct.title,
          descriptionHtml: xmlProduct.description,
          vendor: xmlProduct.vendor,
          productType: xmlProduct.productType,
        }
      },
      `Actualizar producto ${xmlProduct.title}`
    );

    if (!result.success) {
      return {
        success: false,
        error: result.errors.map(e => e.message).join(', ')
      };
    }
    
    if (result.data.productUpdate.userErrors.length > 0) {
      log(LOG_LEVELS.WARN, `User errors para actualización de producto ${xmlProduct.title}`, result.data.productUpdate.userErrors.map(e => e.message));
      return {
        success: false,
        error: result.data.productUpdate.userErrors.map(e => e.message).join(', ')
      };
    }

    return {
      success: true,
      product: result.data.productUpdate.product,
      updated: true
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Función para eliminar un producto de Shopify
async function deleteShopifyProduct(admin, productMapping) {
  try {
    const result = await safeGraphQLCall(
      admin,
      `#graphql
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }`,
      {
        input: {
          id: productMapping.shopifyProductId
        }
      },
      `Eliminar producto ${productMapping.title}`
    );

    if (!result.success) {
      return {
        success: false,
        error: result.errors.map(e => e.message).join(', ')
      };
    }
    
    if (result.data.productDelete.userErrors.length > 0) {
      log(LOG_LEVELS.WARN, `User errors para eliminación de producto ${productMapping.title}`, result.data.productDelete.userErrors.map(e => e.message));
      return {
        success: false,
        error: result.data.productDelete.userErrors.map(e => e.message).join(', ')
      };
    }

    return {
      success: true,
      deletedProductId: result.data.productDelete.deletedProductId
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Función para obtener proveedores que necesitan sincronización
export async function getProvidersToSync(shop) {
  const now = new Date();
  
  return await prisma.xmlProvider.findMany({
    where: {
      shop,
      isActive: true,
      OR: [
        { nextSync: { lte: now } },
        { nextSync: null }
      ]
    },
    include: {
      products: true,
      syncLogs: {
        orderBy: { startedAt: 'desc' },
        take: 1
      }
    }
  });
}