import { getSyncProgress } from "../services/sync-progress.server.js";
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  try {
    console.log('🔍 API sync-progress loader called');
    console.log('🔍 Request URL:', request.url);
    
    // Extraer shop de la URL como query parameter
    const url = new URL(request.url);
    const shopParam = url.searchParams.get('shop');
    
    let shopDomain = shopParam;
    
    // Si no hay shop en la URL, intentar obtenerlo de la sesión
    if (!shopDomain) {
      try {
        const { session } = await authenticate.admin(request);
        console.log('🔍 Session object:', session);
        console.log('🔍 Session shop:', session?.shop);
        shopDomain = session?.shop;
      } catch (authError) {
        console.error('❌ Authentication failed:', authError);
      }
    }
    
    if (!shopDomain) {
      console.error('❌ No shop found in URL params or session');
      return Response.json({ error: 'Shop parameter required' }, { status: 400 });
    }
    
    // Normalizar shop domain (quitar .myshopify.com si está presente)
    const normalizedShop = shopDomain.replace('.myshopify.com', '');
    console.log('✅ Using normalized shop domain:', normalizedShop);

    const progress = await getSyncProgress(normalizedShop);

    // Calcular si hay sincronización activa
    const activeStatuses = ['parsing', 'syncing', 'in_progress', 'finalizing'];
    const isActive = progress && activeStatuses.includes(progress.status) && !progress.completedAt;

    return Response.json({
      ...progress,
      isActive
    });
  } catch (error) {
    console.error('❌ Error in sync-progress API:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};