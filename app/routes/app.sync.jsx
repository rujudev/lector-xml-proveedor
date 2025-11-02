// /app/routes/app.sync.jsx
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { prisma } from "../db.server";
import { getProvidersToSync, syncProvider } from "../services/xml-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Obtener todos los proveedores de esta tienda
  const providers = await prisma.xmlProvider.findMany({
    where: { shop: session.shop },
    include: {
      products: true,
      syncLogs: {
        orderBy: { startedAt: 'desc' },
        take: 5
      }
    }
  });

  // Obtener proveedores que necesitan sync
  const providersToSync = await getProvidersToSync(session.shop);

  return {
    providers,
    providersToSync: providersToSync.map(p => p.id),
    currentTime: new Date().toISOString(),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  
  if (actionType === "syncAll") {
    // Sincronizar todos los proveedores pendientes
    const providersToSync = await getProvidersToSync(session.shop);
    const results = [];
    
    for (const provider of providersToSync) {
      try {
        const result = await syncProvider(admin, provider.id, session.shop);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          ...result
        });
      } catch (error) {
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      action: "syncAll",
      results,
      syncedProviders: results.length,
    };
  }
  
  if (actionType === "syncProvider") {
    const providerId = formData.get("providerId");
    
    try {
      const result = await syncProvider(admin, providerId, session.shop);
      return {
        success: true,
        action: "syncProvider",
        result,
        providerId,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        providerId,
      };
    }
  }
  
  if (actionType === "addProvider") {
    const name = formData.get("name");
    const xmlUrl = formData.get("xmlUrl");
    const syncFrequency = parseInt(formData.get("syncFrequency") || "8");
    const autoDelete = formData.get("autoDelete") === "on";
    
    try {
      // Validar URL
      new URL(xmlUrl);
      
      const provider = await prisma.xmlProvider.create({
        data: {
          shop: session.shop,
          name,
          xmlUrl,
          syncFrequency,
          autoDelete,
          nextSync: new Date(Date.now() + (syncFrequency * 60 * 60 * 1000)),
        }
      });
      
      return {
        success: true,
        action: "addProvider",
        provider,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  return {
    success: false,
    error: "Acción no reconocida",
  };
};

export default function SyncPage() {
  const { providers, providersToSync, currentTime } = useLoaderData();
  const fetcher = useFetcher();
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  const isLoading = ["loading", "submitting"].includes(fetcher.state);

  // Auto-sync cada 30 segundos si está habilitado
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const interval = setInterval(() => {
      if (providersToSync.length > 0 && !isLoading) {
        const formData = new FormData();
        formData.set("actionType", "syncAll");
        fetcher.submit(formData, { method: "POST" });
      }
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [autoSyncEnabled, providersToSync.length, isLoading, fetcher]);

  const handleSyncAll = () => {
    const formData = new FormData();
    formData.set("actionType", "syncAll");
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSyncProvider = (providerId) => {
    const formData = new FormData();
    formData.set("actionType", "syncProvider");
    formData.set("providerId", providerId);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Sincronización de Proveedores XML">
      
      {/* Estado de sincronización */}
      <s-section heading="Estado de Sincronización">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" 
                 background={providersToSync.length > 0 ? "warning-subdued" : "success-subdued"}>
            <s-stack direction="inline" gap="base" alignment="space-between">
              <s-stack direction="block" gap="tight">
                <s-text weight="semibold">
                  {providersToSync.length > 0 
                    ? `⏰ ${providersToSync.length} proveedores necesitan sincronización`
                    : "✅ Todos los proveedores están sincronizados"
                  }
                </s-text>
                <s-text>Última verificación: {new Date(currentTime).toLocaleString('es-ES')}</s-text>
              </s-stack>
              
              <s-stack direction="inline" gap="base">
                <s-checkbox 
                  label="Auto-sync" 
                  checked={autoSyncEnabled}
                  onChange={setAutoSyncEnabled}
                />
                <s-button 
                  onClick={handleSyncAll}
                  disabled={providersToSync.length === 0 || isLoading}
                  loading={isLoading && fetcher.formData?.get("actionType") === "syncAll"}
                >
                  Sincronizar Ahora
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Resultados de sincronización */}
      {fetcher.data?.success && (
        <s-section heading="Resultados de Sincronización">
          <s-stack direction="block" gap="base">
            {fetcher.data.action === "syncAll" && fetcher.data.results?.map((result, index) => (
              <s-box key={index} padding="base" borderWidth="base" borderRadius="base" 
                     background={result.success ? "success-subdued" : "critical-subdued"}>
                <s-stack direction="block" gap="tight">
                  <s-text weight="semibold">
                    {result.success ? "✅" : "❌"} {result.providerName}
                  </s-text>
                  {result.success && (
                    <s-text>
                      Creados: {result.results?.created.length || 0} | 
                      Actualizados: {result.results?.updated.length || 0} | 
                      Eliminados: {result.results?.deleted.length || 0} | 
                      Errores: {result.results?.errors.length || 0}
                    </s-text>
                  )}
                  {!result.success && (
                    <s-text color="critical">Error: {result.error}</s-text>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      {/* Añadir nuevo proveedor */}
      <s-section heading="Añadir Nuevo Proveedor">
        <fetcher.Form method="post">
          <input type="hidden" name="actionType" value="addProvider" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Nombre del Proveedor"
              name="name"
              required
              placeholder="Ej: Proveedor Productos A"
            />
            <s-text-field
              label="URL del XML"
              name="xmlUrl"
              type="url"
              required
              placeholder="https://proveedor.com/productos.xml"
            />
            <s-select
              label="Frecuencia de Sincronización"
              name="syncFrequency"
              options={[
                { value: "4", label: "Cada 4 horas (6 veces al día)" },
                { value: "8", label: "Cada 8 horas (3 veces al día)" },
                { value: "12", label: "Cada 12 horas (2 veces al día)" },
                { value: "24", label: "Una vez al día" },
              ]}
              value="8"
            />
            <s-checkbox
              label="Eliminación automática"
              name="autoDelete"
              helpText="Eliminar productos de Shopify si ya no están en el XML"
              checked
            />
            <s-button 
              type="submit" 
              loading={isLoading && fetcher.formData?.get("actionType") === "addProvider"}
            >
              Añadir Proveedor
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Lista de proveedores */}
      <s-section heading="Proveedores Configurados">
        <s-stack direction="block" gap="base">
          {providers.map((provider) => (
            <s-box key={provider.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" alignment="space-between">
                  <s-stack direction="block" gap="tight">
                    <s-text weight="semibold">{provider.name}</s-text>
                    <s-text>URL: {provider.xmlUrl}</s-text>
                    <s-text>Frecuencia: cada {provider.syncFrequency} horas</s-text>
                    <s-text>Eliminación automática: {provider.autoDelete ? '✅ Habilitada' : '❌ Deshabilitada'}</s-text>
                    <s-text>Productos mapeados: {provider.products.length}</s-text>
                    <s-text>
                      Última sincronización: {provider.lastSync 
                        ? new Date(provider.lastSync).toLocaleString('es-ES')
                        : 'Nunca'
                      }
                    </s-text>
                    <s-text>
                      Próxima sincronización: {provider.nextSync 
                        ? new Date(provider.nextSync).toLocaleString('es-ES')
                        : 'No programada'
                      }
                    </s-text>
                  </s-stack>
                  
                  <s-stack direction="inline" gap="base">
                    <s-button 
                      variant="tertiary"
                      onClick={() => handleSyncProvider(provider.id)}
                      loading={isLoading && fetcher.formData?.get("providerId") === provider.id}
                    >
                      Sincronizar
                    </s-button>
                  </s-stack>
                </s-stack>

                {/* Logs recientes */}
                {provider.syncLogs.length > 0 && (
                  <s-section heading="Logs Recientes">
                    <s-stack direction="block" gap="tight">
                      {provider.syncLogs.slice(0, 3).map((log) => (
                        <s-box key={log.id} padding="tight" background="subdued">
                          <s-stack direction="inline" gap="base" alignment="space-between">
                            <s-text>
                              {new Date(log.startedAt).toLocaleString('es-ES')} - 
                              Status: {log.status} - 
                              Duración: {log.duration}s
                            </s-text>
                            <s-text>
                              C:{log.productsCreated} U:{log.productsUpdated} D:{log.productsDeleted || 0} E:{log.productsErrors}
                            </s-text>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};