// Endpoint SSE simple sin autenticación para diagnóstico
export const loader = async () => {
  console.log('🧪 Simple SSE endpoint called');
  
  try {
    const stream = new ReadableStream({
      start(controller) {
        console.log('🧪 Simple SSE stream started');
        
        // Enviar mensaje inicial inmediatamente
        const initialData = `data: ${JSON.stringify({ 
          type: 'simple_connected', 
          message: 'Simple SSE working without auth',
          timestamp: new Date().toISOString()
        })}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(initialData));
        controller.enqueue(new TextEncoder().encode(': flush\n\n'));
        
        // Enviar ping cada 5 segundos
        let pingCount = 0;
        const pingInterval = setInterval(() => {
          pingCount++;
          
          try {
            const pingData = `data: ${JSON.stringify({ 
              type: 'simple_ping', 
              count: pingCount,
              message: `Simple ping ${pingCount}`,
              timestamp: new Date().toISOString()
            })}\n\n`;
            
            controller.enqueue(new TextEncoder().encode(pingData));
            controller.enqueue(new TextEncoder().encode(': flush\n\n'));
            
            console.log(`🧪 Simple SSE ping ${pingCount} sent`);
            
            // Parar después de 10 pings
            if (pingCount >= 10) {
              clearInterval(pingInterval);
              const finalData = `data: ${JSON.stringify({ 
                type: 'simple_complete', 
                message: 'Simple SSE test completed',
                timestamp: new Date().toISOString()
              })}\n\n`;
              
              controller.enqueue(new TextEncoder().encode(finalData));
              controller.enqueue(new TextEncoder().encode(': flush\n\n'));
            }
          } catch (error) {
            console.error('🧪 Error in simple SSE ping:', error);
            clearInterval(pingInterval);
          }
        }, 5000);
        
        console.log('🧪 Simple SSE initialized successfully');
      },
      
      cancel() {
        console.log('🧪 Simple SSE connection cancelled');
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    });
    
  } catch (error) {
    console.error('🧪 Error in simple SSE endpoint:', error);
    return new Response(`Simple SSE Error: ${error.message}`, { status: 500 });
  }
};