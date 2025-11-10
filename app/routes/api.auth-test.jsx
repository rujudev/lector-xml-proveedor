import { authenticate } from "../shopify.server.js";

// Test endpoint para verificar autenticación
export const loader = async ({ request }) => {
  console.log('🔍 Auth test endpoint called');
  
  try {
    const { session } = await authenticate.admin(request);
    
    if (!session || !session.shop) {
      return Response.json({
        success: false,
        error: 'No session or shop found'
      }, { status: 401 });
    }
    
    const shopDomain = session.shop.replace('.myshopify.com', '');
    
    return Response.json({
      success: true,
      shop: shopDomain,
      sessionId: session.id,
      message: 'Authentication working correctly'
    });
    
  } catch (error) {
    console.error('❌ Auth test error:', error);
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
};