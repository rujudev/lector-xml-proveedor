import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { parseProductsFromXML } from "../services/xml-sync.server.js";

function parseProductsFromXML(xmlContent) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseAttributeValue: true,
    trimValues: true,
    removeNSPrefix: true, // Eliminar namespace g:
    parseTagValue: false,
  });

  try {
    const result = parser.parse(xmlContent);
    console.log('Estructura del XML parseado:', Object.keys(result));
    
    // Detectar diferentes formatos de XML comunes
    let products = [];
    
    // Formato 1: <products><product>...</product></products>
    if (result.products && result.products.product) {
      products = Array.isArray(result.products.product) 
        ? result.products.product 
        : [result.products.product];
    }
    // Formato 2: <catalog><item>...</item></catalog>
    else if (result.catalog && result.catalog.item) {
      products = Array.isArray(result.catalog.item) 
        ? result.catalog.item 
        : [result.catalog.item];
    }
    // Formato 3: RSS feed
    else if (result.rss && result.rss.channel && result.rss.channel.item) {
      products = Array.isArray(result.rss.channel.item) 
        ? result.rss.channel.item 
        : [result.rss.channel.item];
    }
    // Formato 4: Google Shopping Feed
    else if (result.feed && result.feed.entry) {
      products = Array.isArray(result.feed.entry) 
        ? result.feed.entry 
        : [result.feed.entry];
    }
    // Formato 5: RSS directo
    else if (result.channel && result.channel.item) {
      products = Array.isArray(result.channel.item) 
        ? result.channel.item 
        : [result.channel.item];
    }
    // Formato 6: Items directos (tu formato)
    else if (result.item) {
      products = Array.isArray(result.item) 
        ? result.item 
        : [result.item];
    }
    // Formato 7: Raíz directa con productos
    else if (result.product) {
      products = Array.isArray(result.product) 
        ? result.product 
        : [result.product];
    }
    // Búsqueda automática si no se encuentra un formato conocido
    else {
      for (const [key, value] of Object.entries(result)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          console.log(`Encontrados productos en: ${key}`);
          products = value;
          break;
        } else if (typeof value === 'object' && value !== null) {
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            if (Array.isArray(nestedValue) && nestedValue.length > 0 && typeof nestedValue[0] === 'object') {
              console.log(`Encontrados productos en: ${key}.${nestedKey}`);
              products = nestedValue;
              break;
            }
          }
          if (products.length > 0) break;
        }
      }
    }

    console.log(products)

    return products.map((product, index) => {
      // Debug: mostrar estructura del primer producto
      if (index === 0) {
        console.log('Estructura del primer producto:', Object.keys(product));
        console.log('Primer producto completo:', product);
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
        description: product.description || product.summary || product.title || '',
        price: price,
        sku: product.sku || product.id || product.gtin || product.code || null,
        vendor: product.brand || product.vendor || product.manufacturer || 'Proveedor XML',
        productType: product.category || product.type || product.productType || 'General',
        tags: extractTags(product),
        images: extractImages(product),
        variants: extractVariants(product),
        // Campos adicionales específicos del formato Google Shopping
        condition: product.condition || 'new',
        availability: product.availability || 'in_stock',
        color: product.color || null,
        gtin: product.gtin || null,
        link: product.link || null,
      };
    });
  } catch (error) {
    throw new Error(`Error al parsear XML: ${error.message}`);
  }
}

// Función para extraer imágenes del producto
function extractImages(product) {
  const images = [];
  
  // Google Shopping format: image_link
  if (product.image_link) {
    images.push(product.image_link);
  }
  
  // Formatos tradicionales
  if (product.image) {
    const imageUrls = Array.isArray(product.image) ? product.image : [product.image];
    images.push(...imageUrls);
  }
  
  if (product.images && product.images.image) {
    const imageUrls = Array.isArray(product.images.image) ? product.images.image : [product.images.image];
    images.push(...imageUrls);
  }
  
  return images.filter(img => typeof img === 'string' && img.startsWith('http'));
}

// Función para extraer tags del producto
function extractTags(product) {
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

// Función para extraer variantes del producto
function extractVariants(product) {
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

// Función para crear productos en Shopify por lotes
async function createShopifyProducts(admin, products, batchSize = 10, maxProducts = 50) {
  const results = [];
  const errors = [];
  
  // Limitar el número total de productos a procesar
  const productsToProcess = products.slice(0, maxProducts);
  
  console.log(`Procesando ${productsToProcess.length} productos en lotes de ${batchSize}`);

  // Procesar en lotes para evitar timeouts
  for (let i = 0; i < productsToProcess.length; i += batchSize) {
    const batch = productsToProcess.slice(i, i + batchSize);
    console.log(`Procesando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(productsToProcess.length / batchSize)}: productos ${i + 1}-${Math.min(i + batchSize, productsToProcess.length)}`);
    
    // Procesar batch
    for (const product of batch) {
    try {
      const shopifyProduct = {
        title: product.title,
        descriptionHtml: product.description,
        vendor: product.vendor,
        productType: product.productType,
        tags: Array.isArray(product.tags) ? product.tags.join(', ') : product.tags,
      };

      const response = await admin.graphql(
        `#graphql
        mutation productCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              # id
              title
              handle
              status
              variants(first: 10) {
                edges {
                  node {
                    id
                    price
                    sku
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
        {
          variables: {
            product: shopifyProduct,
          },
        },
      );

      const responseJson = await response.json();
      
      // Verificar si hay errores de GraphQL
      if (responseJson.errors) {
        console.error(`GraphQL errors para producto ${product.title}:`, responseJson.errors.map(e => e.message).join(', '));
        errors.push({
          product: product.title,
          errors: responseJson.errors,
        });
      } else if (responseJson.data.productCreate.userErrors.length > 0) {
        console.error(`User errors para producto ${product.title}:`, responseJson.data.productCreate.userErrors.map(e => e.message).join(', '));
        errors.push({
          product: product.title,
          errors: responseJson.data.productCreate.userErrors,
        });
      } else {
        const createdProduct = responseJson.data.productCreate.product;
        
        // Actualizar la primera variante con precio y SKU si existe
        if (product.variants.length > 0 && createdProduct.variants.edges.length > 0) {
          const variantId = createdProduct.variants.edges[0].node.id;
          const firstVariant = product.variants[0];

          try {
            await admin.graphql(
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
                variables: {
                  productId: createdProduct.id,
                  variants: [{
                    id: variantId,
                    price: firstVariant.price.toString(),
                    sku: firstVariant.sku,
                  }]
                }
              }
            );
          } catch (variantError) {
            console.warn(`Error actualizando variante para ${product.title}:`, variantError);
          }
        }
        
        results.push(createdProduct);
      }
    } catch (error) {
      errors.push({
        product: product.title,
        error: error.message,
      });
    }
    }
    
    // Pequeña pausa entre lotes para no sobrecargar la API
    if (i + batchSize < productsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Pausa de 1 segundo
    }
  }

  return { results, errors };
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const xmlUrl = formData.get("xmlUrl");
  
  if (!xmlUrl) {
    return {
      error: "URL es requerida",
    };
  }

  try {
    // Validar que la URL tenga formato válido
    new URL(xmlUrl);
    
    // Hacer la petición al XML
    const response = await fetch(xmlUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'User-Agent': 'Lector-XML-Proveedor/1.0',
      },
    });

    if (!response.ok) {
      return {
        error: `Error al obtener el XML: ${response.status} ${response.statusText}`,
      };
    }

    const xmlContent = await response.text();
    
    // Parsear el XML y extraer productos
    let parsedProducts = [];
    let shopifyResults = [];
    let shopifyErrors = [];
    
    try {
      parsedProducts = parseProductsFromXML(xmlContent);
      
      if (parsedProducts.length > 0) {
        // Obtener parámetros de procesamiento
        const batchSize = parseInt(formData.get("batchSize") || "10");
        const maxProducts = parseInt(formData.get("maxProducts") || "100");
        
        console.log(`Iniciando procesamiento: ${parsedProducts.length} productos encontrados, procesando máximo ${maxProducts} en lotes de ${batchSize}`);
        
        // Crear productos en Shopify por lotes
        const createResults = await createShopifyProducts(admin, parsedProducts, batchSize, maxProducts);
        shopifyResults = createResults.results;
        shopifyErrors = createResults.errors;
      }
    } catch (parseError) {
      return {
        error: `Error al procesar el XML: ${parseError.message}`,
        xmlContent,
        xmlUrl,
      };
    }
    
    return {
      success: true,
      xmlUrl,
      xmlContent,
      contentType: response.headers.get('content-type'),
      timestamp: new Date().toISOString(),
      parsedProducts,
      productsCreated: shopifyResults.length,
      shopifyResults,
      shopifyErrors,
      totalProductsParsed: parsedProducts.length,
    };

  } catch (error) {
    return {
      error: error.message || 'Error desconocido al procesar la URL',
    };
  }
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.success) {
      const totalFound = fetcher.data.totalProductsParsed || 0;
      const created = fetcher.data.productsCreated || 0;
      const errors = fetcher.data.shopifyErrors?.length || 0;
      
      let message = `✅ XML procesado: ${totalFound} productos encontrados`;
      if (created > 0) {
        message += `, ${created} creados en Shopify`;
      }
      if (errors > 0) {
        message += `, ${errors} errores`;
      }
      
      shopify.toast.show(message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Lector XML Proveedor">
      <s-section slot="" heading="Obtener XML desde URL">
        <s-paragraph>
          Introduce la URL de un archivo XML para descargarlo, procesarlo y crear productos en Shopify.
          El sistema procesa productos en lotes para manejar catálogos grandes sin timeouts.
        </s-paragraph>
        
        <s-banner tone="info">
          <s-text weight="semibold">💡 Procesamiento por lotes</s-text>
          <s-text>Para catálogos grandes (como tu proveedor con 1811 productos), ajusta:</s-text>
          <s-unordered-list>
            <s-list-item><strong>Máximo productos:</strong> Empieza con 100 para probar</s-list-item>
            <s-list-item><strong>Tamaño del lote:</strong> 10 productos por lote es seguro</s-list-item>
            <s-list-item><strong>Progreso:</strong> El procesamiento se hará gradualmente para evitar timeouts</s-list-item>
          </s-unordered-list>
        </s-banner>
        
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="URL del archivo XML"
              name="xmlUrl"
              type="url"
              placeholder="https://ejemplo.com/productos.xml"
              helpText="Introduce una URL válida que apunte a un archivo XML"
              required
            />
            
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Máximo productos a procesar"
                name="maxProducts"
                type="number"
                value="100"
                min="1"
                max="1000"
                helpText="Limita el número de productos para evitar timeouts"
              />
              <s-text-field
                label="Tamaño del lote"
                name="batchSize"
                type="number"
                value="10"
                min="1"
                max="50"
                helpText="Productos a procesar por lote (menor = más lento pero más seguro)"
              />
            </s-stack>
            
            <s-button
              type="submit"
              {...(isLoading ? { loading: true } : {})}
            >
              {isLoading ? "Procesando productos..." : "Procesar XML"}
            </s-button>
          </s-stack>
        </fetcher.Form>

        {fetcher.data?.error && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="critical-subdued"
          >
            <s-text color="critical">
              Error: {fetcher.data.error}
            </s-text>
          </s-box>
        )}

        {fetcher.data?.success && (
          <div>
            <s-section heading="Resultados del procesamiento">
              <s-stack direction="block" gap="base">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="success-subdued"
                >
                  <s-stack direction="block" gap="tight">
                    <s-text weight="semibold">✅ XML procesado correctamente</s-text>
                    <s-text>URL: {fetcher.data.xmlUrl}</s-text>
                    <s-text>Tipo de contenido: {fetcher.data.contentType}</s-text>
                    <s-text>Fecha: {new Date(fetcher.data.timestamp).toLocaleString('es-ES')}</s-text>
                    <s-text>Productos encontrados: {fetcher.data.totalProductsParsed}</s-text>
                    <s-text>Productos creados en Shopify: {fetcher.data.productsCreated}</s-text>
                  </s-stack>
                </s-box>

                {fetcher.data.shopifyResults && fetcher.data.shopifyResults.length > 0 && (
                  <s-section heading="Productos creados en Shopify">
                    <s-stack direction="block" gap="base">
                      {fetcher.data.shopifyResults.map((product) => (
                        <s-box
                          key={product.id}
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                          background="subdued"
                        >
                          <s-stack direction="block" gap="tight">
                            <s-text weight="semibold">🛍️ {product.title}</s-text>
                            <s-text>ID: {product.id}</s-text>
                            <s-text>Handle: {product.handle}</s-text>
                            <s-text>Estado: {product.status}</s-text>
                            {product.variants.edges.length > 0 && (
                              <s-text>Precio: ${product.variants.edges[0].node.price}</s-text>
                            )}
                            <s-button
                              onClick={() => {
                                shopify.intents.invoke?.("edit:shopify/Product", {
                                  value: product.id,
                                });
                              }}
                              variant="tertiary"
                              size="slim"
                            >
                              Editar en Shopify
                            </s-button>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                )}

                {fetcher.data.shopifyErrors && fetcher.data.shopifyErrors.length > 0 && (
                  <s-section heading="Errores al crear productos">
                    <s-stack direction="block" gap="base">
                      {fetcher.data.shopifyErrors.map((error, index) => (
                        <s-box
                          key={index}
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                          background="critical-subdued"
                        >
                          <s-stack direction="block" gap="tight">
                            <s-text weight="semibold" color="critical">❌ {error.product}</s-text>
                            <s-text color="critical">
                              {error.error || error.errors?.map(e => e.message).join(', ')}
                            </s-text>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                )}

                {fetcher.data.parsedProducts && fetcher.data.parsedProducts.length > 0 && (
                  <s-section heading="Productos parseados del XML">
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-text weight="semibold">Vista previa de productos:</s-text>
                      <pre style={{ margin: '8px 0 0 0', maxHeight: '300px', overflow: 'auto', fontSize: '11px' }}>
                        <code>{JSON.stringify(fetcher.data.parsedProducts.slice(0, 3), null, 2)}</code>
                      </pre>
                      {fetcher.data.parsedProducts.length > 3 && (
                        <s-text>... y {fetcher.data.parsedProducts.length - 3} productos más</s-text>
                      )}
                    </s-box>
                  </s-section>
                )}

                <s-section heading="XML original" slot="collapsible">
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-text weight="semibold">Contenido XML completo:</s-text>
                    <pre style={{ margin: '8px 0 0 0', maxHeight: '200px', overflow: 'auto', fontSize: '10px' }}>
                      <code>{fetcher.data.xmlContent}</code>
                    </pre>
                  </s-box>
                </s-section>
              </s-stack>
            </s-section>
          </div>
        )}
        
        {fetcher.data?.success && fetcher.data.totalProductsParsed > fetcher.data.productsCreated && (
          <s-banner tone="warning">
            <s-text weight="semibold">⚠️ Procesamiento parcial</s-text>
            <s-text>
              Se encontraron {fetcher.data.totalProductsParsed} productos pero solo se procesaron {fetcher.data.productsCreated}.
              Para procesar todos los productos automáticamente:
            </s-text>
            <s-stack direction="inline" gap="base">
              <s-button href="/app/sync" variant="primary">
                Ir a Sincronización Automática
              </s-button>
              <s-text>Configure este proveedor para procesamiento completo y automático</s-text>
            </s-stack>
          </s-banner>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
