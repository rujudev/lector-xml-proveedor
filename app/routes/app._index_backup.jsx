import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server.js";
import styles from "./app._index/styles.module.css";

// CSS inline para animaciones
const animationStyles = `
  @keyframes fadeInSlide {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

export const action = async ({ request }) => {
  console.error('🚨 [ACTION] Action ejecutado - Método:', request.method);
  
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    console.error('✅ [ACTION] Autenticación exitosa');
    
    const formData = await request.formData();
    const xmlUrl = formData.get("xmlUrl");
    
    if (!xmlUrl) {
      return Response.json({ error: "URL del XML es requerida" }, { status: 400 });
    }

    // SOLO parsear XML - NO procesar
    const { parseXMLData } = await import("../services/xml-sync.server.js");
    const parsedProducts = await parseXMLData(xmlUrl);
    
    if (!parsedProducts || parsedProducts.length === 0) {
      return Response.json({ error: "No se encontraron productos en el XML" }, { status: 400 });
    }

    console.error(`📦 [ACTION] Parseados ${parsedProducts.length} productos - enviando al cliente`);

    const shopDomain = session.shop.replace('.myshopify.com', '');
    
    // Devolver productos parseados al cliente
    return Response.json({
      success: true,
      totalProducts: parsedProducts.length,
      products: parsedProducts, // ← Los productos van al cliente
      message: 'XML parseado exitosamente',
      shopDomain,
      parsedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ACTION] Error:', error);
    return Response.json({ 
      error: error.message || "Error parseando XML",
      success: false 
    }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { getSyncProgress } = await import("../services/sync-progress.server.js");

  const shopDomain = session.shop.replace('.myshopify.com', '');
  const currentProgress = await getSyncProgress(shopDomain);

  return Response.json({
    progress: currentProgress,
    shop: shopDomain,
    sessionId: session.id
  });
};

export default function Index() {
  console.warn('🎯 [CLIENT] Renderizando componente');

  const fetcher = useFetcher();
  const loaderData = useLoaderData();
  const [syncState, setSyncState] = useState(null); // Estado unificado

  const actionData = fetcher.data;
  const isLoading = fetcher.state === "submitting";
  const sessionId = loaderData?.sessionId;

  // Función unificada para actualizar el estado del sync
  const updateSyncState = (data, type) => {
    setSyncState(prev => {
      const newProduct = {
        id: Date.now() + Math.random(),
        title: data.productTitle,
        type: type,
        timestamp: Date.now(),
        sku: data.productSku,
        timing: data.timing
      };
      
      const updatedProducts = prev?.recentProducts ? [newProduct, ...prev.recentProducts.slice(0, 9)] : [newProduct];
      
      return {
        processedItems: data.processed,
        successItems: data.success,
        errorItems: data.errors || 0,
        totalItems: data.total,
        currentStep: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${data.productTitle}`,
        status: 'syncing',
        isActive: true,
        recentProducts: updatedProducts
      };
    });
  };

  useEffect(() => {
    console.warn('🔗 [SSE] Estableciendo conexión SSE persistente');
    console.warn('🔗 [SSE] SessionId:', sessionId);

    const sseUrl = sessionId
      ? `/api/sync-events?sessionId=${encodeURIComponent(sessionId)}`
      : `/api/sync-events`;

    console.warn('🔗 [SSE] URL:', sseUrl);

    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.warn('🟢 [SSE] Conexión abierta exitosamente');
    };

    eventSource.onerror = (error) => {
      console.error('❌ [SSE] Error de conexión:', error);
    };

    eventSource.addEventListener('connected', (event) => {
      const data = JSON.parse(event.data);
      console.warn('🔗 [SSE] Conectado a shop:', data.shop);
    });

    eventSource.addEventListener('sync_started', (event) => {
      const data = JSON.parse(event.data);
      console.warn(`🚀 [SSE] ${Date.now()} - SYNC STARTED:`, data.message, '- Total:', data.totalItems);
    });

    eventSource.addEventListener('created', (event) => {
      const data = JSON.parse(event.data);
      const timestamp = Date.now();
      console.warn(`🆕 [SSE] ${timestamp} - CREATED: ${data.productTitle} (${data.processed}/${data.total})${data.timing ? ` [${data.timing.search + data.timing.create}ms]` : ''}`);
      updateSyncState(data, 'created');
    });

    eventSource.addEventListener('updated', (event) => {
      const data = JSON.parse(event.data);
      const timestamp = Date.now();
      console.warn(`📡 [SSE] ${timestamp} - UPDATED: ${data.productTitle} (${data.processed}/${data.total})${data.timing ? ` [${data.timing.search + data.timing.update}ms]` : ''}`);
      updateSyncState(data, 'updated');
    });

    eventSource.addEventListener('skipped', (event) => {
      const data = JSON.parse(event.data);
      const timestamp = Date.now();
      console.warn(`⏭️ [SSE] ${timestamp} - SKIPPED: ${data.productTitle} (${data.processed}/${data.total})`);
      updateSyncState(data, 'skipped');
    });

    eventSource.addEventListener('sync_completed', (event) => {
      const data = JSON.parse(event.data);
      console.warn('🎉 [SSE] SYNC COMPLETED:', data.summary);

      setSyncState(prev => ({
        ...prev,
        status: 'completed',
        currentStep: `Completado: ${data.successItems} productos procesados`,
        processedItems: data.processedItems,
        successItems: data.successItems,
        errorItems: data.errorItems,
        totalItems: data.totalItems,
        completedAt: data.completedAt
      }));
    });

    return () => {
      console.warn('🔌 [SSE] Cerrando conexión');
      eventSource.close();
    };
  }, [sessionId]);

  // ✨ NUEVO: useEffect que inicia procesamiento cuando recibimos productos del action
  useEffect(() => {
    if (!actionData?.success || !actionData?.products) return;
    
    const startTime = performance.now();
    console.warn(`🎯 [CLIENT] ${Date.now()} - Productos recibidos del action, iniciando procesamiento...`);
    console.warn('🎯 [CLIENT] Productos:', actionData.products.length, 'Shop:', actionData.shopDomain);
    
    // Llamar al endpoint de procesamiento
    const startProcessing = async () => {
      try {
        console.warn(`📤 [CLIENT] ${Date.now()} - Enviando productos para procesamiento...`);
        
        const response = await fetch('/api/process-products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            products: actionData.products,
            shopDomain: actionData.shopDomain
          })
        });
        
        const result = await response.json();
        const endTime = performance.now();
        
        if (result.success) {
          console.warn(`✅ [CLIENT] ${Date.now()} - Procesamiento iniciado exitosamente (${Math.round(endTime - startTime)}ms)`);
          console.warn('🔄 [CLIENT] Esperando eventos SSE...');
        } else {
          console.error('❌ [CLIENT] Error iniciando procesamiento:', result.error);
        }
        
      } catch (error) {
        console.error('❌ [CLIENT] Error llamando procesamiento:', error);
      }
    };
    
    startProcessing();
    
  }, [actionData]); // ← Se ejecuta cuando actionData cambia

  return (
    <div className={styles.xmlApp}>
      <s-page heading="Importar Productos desde XML">
        <s-section>
          <s-card>
            <s-stack gap="base">
              <s-text variant="heading-md">
                Importar Productos desde XML
              </s-text>

              <s-text variant="body-md" tone="subdued">
                Importa productos desde un feed XML de Google Shopping en tiempo real.
              </s-text>

              <fetcher.Form method="post">
                <s-stack gap="base">
                  <s-text-field
                    label="URL del XML"
                    name="xmlUrl"
                    type="url"
                    placeholder="https://ejemplo.com/products.xml"
                    required
                    details="URL del feed XML con los productos de Google Shopping"
                  />

                  <s-button
                    variant="primary"
                    type="submit"
                    loading={isLoading}
                    disabled={isLoading}
                  >
                    {isLoading ? "Importando..." : "Importar Productos"}
                  </s-button>

                  {syncState && (
                    <s-stack gap="tight">
                      <s-text variant="body-md" fontWeight="semibold">
                        {syncState.currentStep}
                      </s-text>

                      <s-text variant="caption">
                        📦 {syncState.processedItems} de {syncState.totalItems} procesados
                        | ✅ {syncState.successItems} exitosos
                        {syncState.errorItems > 0 && ` | ❌ ${syncState.errorItems} errores`}
                      </s-text>

                      <s-text variant="caption" tone="success">
                        📡 Tiempo real - {syncState.recentProducts?.length || 0} productos recientes
                      </s-text>
                    </s-stack>
                  )}

                  {/* Estado unificado: productos procesados en tiempo real */}
                  {syncState?.recentProducts?.length > 0 && (
                    <s-stack gap="tight">
                      <s-text variant="body-md" fontWeight="semibold" tone="subdued">
                        🚀 Últimos productos procesados:
                      </s-text>
                      <div style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        padding: '8px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '6px',
                        border: '1px solid #e1e3e5'
                      }}>
                        <s-stack gap="extra-tight">
                          {syncState.recentProducts.map((item) => (
                            <div 
                              key={item.id} 
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '4px 8px',
                                backgroundColor: item.type === 'created' ? '#e8f5e8' : 
                                                item.type === 'updated' ? '#e8f1ff' : '#fff3cd',
                                borderRadius: '4px',
                                fontSize: '12px',
                                animation: 'fadeInSlide 0.3s ease-out'
                              }}
                            >
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span>
                                  {item.type === 'created' ? '🆕' : item.type === 'updated' ? '📡' : '⏭️'}
                                </span>
                                <s-text variant="caption" tone="subdued">
                                  {item.title.length > 40 ? `${item.title.substring(0, 37)}...` : item.title}
                                </s-text>
                              </div>
                              <s-text variant="caption" tone="subdued">
                                {item.timing ? `${(item.timing.search || 0) + (item.timing.create || item.timing.update || 0)}ms` : ''}
                              </s-text>
                            </div>
                          ))}
                        </s-stack>
                      </div>
                    </s-stack>
                  )}
                </s-stack>
              </fetcher.Form>
            </s-stack>
          </s-card>
        </s-section>

        {actionData?.success && (
          <s-section>
            <s-card>
              <s-banner tone="success">
                <s-stack gap="tight">
                  <s-text variant="body-md" fontWeight="semibold">
                    � XML parseado exitosamente
                  </s-text>
                  <s-text variant="body-sm">
                    📦 {actionData.totalProducts} productos encontrados
                  </s-text>
                  <s-text variant="body-sm" tone="subdued">
                    🚀 Iniciando procesamiento automático...
                  </s-text>
                  <s-text variant="body-sm" tone="subdued">
                    📡 Progreso en tiempo real aparecerá arriba
                  </s-text>
                </s-stack>
              </s-banner>
            </s-card>
          </s-section>
        )}

        {actionData?.error && (
          <s-section>
            <s-card>
              <s-banner tone="critical">
                <s-text>{actionData.error}</s-text>
              </s-banner>
            </s-card>
          </s-section>
        )}
      </s-page>
    </div>
  );
}