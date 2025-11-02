import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { parseProductsFromXML } from "../services/xml-sync.server.js";

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

    // Procesar cada producto en el lote
    for (const product of batch) {
      const shopifyProduct = {
        title: product.title,
        descriptionHtml: product.description,
        vendor: product.vendor,
        productType: product.productType,
        tags: Array.isArray(product.tags) ? product.tags.join(', ') : product.tags,
      };

      try {
        const response = await admin.graphql(
          `#graphql
          mutation productCreate($product: ProductCreateInput!) {
            productCreate(product: $product) {
              product {
                id
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
          
          // Actualizar variantes usando REST API si tenemos datos específicos
          if (product.variants?.length > 0 && createdProduct.variants.edges.length > 0) {
            try {
              // Extraer el ID numérico del product ID de GraphQL (gid://shopify/Product/123456789)
              const numericProductId = createdProduct.id.split('/').pop();
              
              // Obtener el producto para actualizar sus variantes
              const productToUpdate = new admin.rest.Product({ session: admin.session });
              productToUpdate.id = parseInt(numericProductId);
              
              // Obtener las variantes existentes del producto
              const existingProduct = await admin.rest.Product.find({
                session: admin.session,
                id: parseInt(numericProductId)
              });

              if (existingProduct?.variants && existingProduct.variants.length > 0) {
                // Actualizar la primera variante con los datos del XML
                const firstVariant = product.variants[0];
                const variantToUpdate = new admin.rest.Variant({ session: admin.session });
                
                variantToUpdate.id = existingProduct.variants[0].id;
                variantToUpdate.price = firstVariant.price;
                variantToUpdate.sku = firstVariant.sku;
                
                await variantToUpdate.save();
              }
              
            } catch (restError) {
              console.error(`Error actualizando variantes REST para ${product.title}:`, restError.message);
            }
          }
          
          results.push(createdProduct);
        }
      } catch (error) {
        errors.push({
          product: product.title,
          errors: [{ message: error.message }],
        });
      }
    }

    // Pausa entre lotes para no sobrecargar la API
    if (i + batchSize < productsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { results, errors };
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const xmlUrl = formData.get("xmlUrl");
    const maxProducts = parseInt(formData.get("maxProducts") || "100");
    const batchSize = parseInt(formData.get("batchSize") || "10");

    if (!xmlUrl) {
      return Response.json({ error: "URL del XML es requerida" }, { status: 400 });
    }

    // Validaciones
    if (maxProducts > 500) {
      return Response.json({ error: "Máximo 500 productos por procesamiento" }, { status: 400 });
    }

    if (batchSize > 50) {
      return Response.json({ error: "Máximo 50 productos por lote" }, { status: 400 });
    }

    // Descargar XML
    const response = await fetch(xmlUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'User-Agent': 'Lector-XML-Proveedor/1.0',
      },
    });

    if (!response.ok) {
      return Response.json({ 
        error: `Error al descargar XML: ${response.status} ${response.statusText}` 
      }, { status: 400 });
    }

    const xmlContent = await response.text();
    const parsedProducts = parseProductsFromXML(xmlContent);

    if (!parsedProducts || parsedProducts.length === 0) {
      return Response.json({ 
        error: "No se encontraron productos válidos en el XML" 
      }, { status: 400 });
    }

    console.log(`Iniciando procesamiento: ${parsedProducts.length} productos encontrados, procesando máximo ${maxProducts} en lotes de ${batchSize}`);

    const { results, errors } = await createShopifyProducts(admin, parsedProducts, batchSize, maxProducts);

    return Response.json({
      success: true,
      totalFound: parsedProducts.length,
      created: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
      wasLimited: parsedProducts.length > maxProducts,
    });
  } catch (error) {
    console.error("Error procesando XML:", error);
    return Response.json({ 
      error: `Error procesando productos: ${error.message}` 
    }, { status: 500 });
  }
};

export default function Index() {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.data && fetcher.data.results) {
      console.log("Productos creados:", fetcher.data);
    }
  }, [fetcher.data]);

  const isLoading = fetcher.state === "submitting";

  return (
    <s-page title="Lector XML Proveedor">
      <s-section>
        <s-card>
          <s-block-stack gap="4">
            <s-text variant="headingLg" as="h2">
              Importar Productos desde XML
            </s-text>
            
            <fetcher.Form method="post">
              <s-block-stack gap="4">
                <s-form-layout>
                  <s-text-field
                    label="URL del archivo XML"
                    name="xmlUrl"
                    placeholder="https://ejemplo.com/productos.xml"
                    required
                    helpText="URL pública del archivo XML con los productos del proveedor"
                  />
                  
                  <s-inline-stack gap="4">
                    <s-text-field
                      label="Máximo productos"
                      name="maxProducts"
                      type="number"
                      value="100"
                      min="1"
                      max="500"
                      helpText="Número máximo de productos a procesar (máx. 500)"
                    />
                    
                    <s-text-field
                      label="Tamaño del lote"
                      name="batchSize"
                      type="number"
                      value="10"
                      min="1"
                      max="50"
                      helpText="Productos por lote (máx. 50)"
                    />
                  </s-inline-stack>
                </s-form-layout>

                <s-button
                  variant="primary"
                  loading={isLoading}
                  disabled={isLoading}
                  submit
                >
                  {isLoading ? "Procesando..." : "Importar Productos"}
                </s-button>
              </s-block-stack>
            </fetcher.Form>
          </s-block-stack>
        </s-card>

        {fetcher.data?.wasLimited && (
          <s-banner tone="warning">
            <p>
              <strong>Procesamiento parcial:</strong> Se encontraron {fetcher.data.totalFound} productos, 
              pero solo se procesaron {fetcher.data.created} debido al límite configurado.
            </p>
            <p>
              Para procesar más productos, aumenta el valor de &quot;Máximo productos&quot; o usa la 
              funcionalidad de sincronización automática en la página de proveedores.
            </p>
          </s-banner>
        )}

        {fetcher.data?.results && (
          <s-card>
            <s-block-stack gap="4">
              <s-text variant="headingMd" as="h3">
                Resultados de la Importación
              </s-text>
              
              <s-inline-stack gap="4">
                <s-badge tone="success">
                  {fetcher.data.created} creados
                </s-badge>
                
                {fetcher.data.errors > 0 && (
                  <s-badge tone="critical">
                    {fetcher.data.errors} errores
                  </s-badge>
                )}
                
                <s-badge>
                  {fetcher.data.totalFound} total encontrados
                </s-badge>
              </s-inline-stack>

              {fetcher.data.results.length > 0 && (
                <s-block-stack gap="2">
                  <s-text variant="headingSm" as="h4">
                    Productos creados exitosamente:
                  </s-text>
                  
                  {fetcher.data.results.slice(0, 10).map((product, index) => (
                    <s-inline-stack key={index} gap="2" wrap="no-wrap">
                      <s-badge>#{product.id.split('/').pop()}</s-badge>
                      <s-text as="span" truncate>{product.title}</s-text>
                    </s-inline-stack>
                  ))}
                  
                  {fetcher.data.results.length > 10 && (
                    <s-text tone="subdued">
                      ... y {fetcher.data.results.length - 10} productos más
                    </s-text>
                  )}
                </s-block-stack>
              )}

              {fetcher.data.errorDetails && fetcher.data.errorDetails.length > 0 && (
                <s-block-stack gap="2">
                  <s-text variant="headingSm" as="h4" tone="critical">
                    Errores encontrados:
                  </s-text>
                  
                  {fetcher.data.errorDetails.slice(0, 5).map((error, index) => (
                    <s-block-stack key={index} gap="1">
                      <s-text as="span" fontWeight="semibold">{error.product}</s-text>
                      <s-text as="span" tone="subdued" size="small">
                        {error.errors.map(e => e.message).join(', ')}
                      </s-text>
                    </s-block-stack>
                  ))}
                  
                  {fetcher.data.errorDetails.length > 5 && (
                    <s-text tone="subdued">
                      ... y {fetcher.data.errorDetails.length - 5} errores más
                    </s-text>
                  )}
                </s-block-stack>
              )}
            </s-block-stack>
          </s-card>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};