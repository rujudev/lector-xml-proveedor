// /app/routes/api.sync-cron.jsx
import { prisma } from "../../db.server";

// Esta ruta será llamada por un cron job externo o scheduler
export const action = async ({ request }) => {
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "Método no permitido" }, { status: 405 });
    }

    // Verificar token de seguridad (opcional)
    const authHeader = request.headers.get("Authorization");
    // eslint-disable-next-line no-undef
    const expectedToken = process.env.CRON_AUTH_TOKEN || "default-token";
    
    if (authHeader !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Obtener todas las tiendas con proveedores activos
    const activeProviders = await prisma.xmlProvider.findMany({
      where: {
        isActive: true,
        OR: [
          { nextSync: { lte: new Date() } },
          { nextSync: null }
        ]
      },
      include: {
        products: true
      }
    });

    const results = [];
    
    // Procesar cada proveedor
    for (const provider of activeProviders) {
      try {
        // Necesitamos autenticarnos para cada tienda
        // En un escenario real, necesitarías almacenar y usar tokens de acceso
        // console.log(`Sincronizando proveedor ${provider.name} para tienda ${provider.shop}`);
        
        // Por ahora, solo registramos que se intentó la sincronización
        await prisma.syncLog.create({
          data: {
            providerId: provider.id,
            status: 'scheduled',
            totalProducts: 0,
            details: JSON.stringify({ 
              message: "Sincronización programada desde cron",
              shop: provider.shop 
            }),
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 0,
          }
        });

        results.push({
          providerId: provider.id,
          providerName: provider.name,
          shop: provider.shop,
          status: "scheduled"
        });

      } catch (error) {
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          shop: provider.shop,
          status: "error",
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      processedProviders: results.length,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Error en sync-cron:", error);
    return Response.json(
      { error: "Error interno del servidor", details: error.message },
      { status: 500 }
    );
  }
};

// Endpoint GET para verificar el estado
export const loader = async () => {
  try {
    const now = new Date();
    
    const providersToSync = await prisma.xmlProvider.findMany({
      where: {
        isActive: true,
        OR: [
          { nextSync: { lte: now } },
          { nextSync: null }
        ]
      },
      select: {
        id: true,
        name: true,
        shop: true,
        nextSync: true,
        lastSync: true,
      }
    });

    const recentLogs = await prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: {
        provider: {
          select: {
            name: true,
            shop: true,
          }
        }
      }
    });

    return Response.json({
      currentTime: now.toISOString(),
      providersNeedingSync: providersToSync.length,
      providers: providersToSync,
      recentLogs: recentLogs.map(log => ({
        id: log.id,
        providerName: log.provider.name,
        shop: log.provider.shop,
        status: log.status,
        startedAt: log.startedAt,
        duration: log.duration,
        productsCreated: log.productsCreated,
        productsUpdated: log.productsUpdated,
        productsErrors: log.productsErrors,
      }))
    });
  } catch (error) {
    return Response.json(
      { error: "Error al obtener estado", details: error.message },
      { status: 500 }
    );
  }
};