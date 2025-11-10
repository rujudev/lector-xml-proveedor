// Endpoint de prueba para verificar que SSE funciona
export const loader = async () => {
  console.log('🧪 Test SSE endpoint called');
  
  try {
    const stream = new ReadableStream({
      start(controller) {
        console.log('🧪 Test SSE stream started');
        
        // Enviar mensaje inicial
        const data = `data: ${JSON.stringify({ 
          type: 'test', 
          message: 'SSE connection working',
          timestamp: new Date().toISOString()
        })}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(data));
        
        // CLAVE: Forzar flush del buffer inicial
        controller.enqueue(new TextEncoder().encode(': flush\n\n'));
        
        // Enviar mensajes cada segundo por 10 segundos
        let counter = 0;
        const interval = setInterval(() => {
          counter++;
          
          const testData = `data: ${JSON.stringify({ 
            type: 'ping', 
            count: counter,
            message: `Test message ${counter}`,
            timestamp: new Date().toISOString()
          })}\n\n`;
          
          try {
            controller.enqueue(new TextEncoder().encode(testData));
            
            // CLAVE: Forzar flush después de cada mensaje
            controller.enqueue(new TextEncoder().encode(': flush\n\n'));
            
            console.log(`🧪 Sent test message ${counter}`);
            
            if (counter >= 10) {
              clearInterval(interval);
              const finalData = `data: ${JSON.stringify({ 
                type: 'complete', 
                message: 'Test completed',
                timestamp: new Date().toISOString()
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(finalData));
              controller.close();
            }
          } catch (error) {
            console.error('🧪 Error sending test message:', error);
            clearInterval(interval);
            controller.close();
          }
        }, 1000);
        
        console.log('🧪 Test SSE initialized');
      },
      
      cancel() {
        console.log('🧪 Test SSE connection cancelled');
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
    console.error('🧪 Error in test SSE endpoint:', error);
    return new Response('Test SSE Error', { status: 500 });
  }
};