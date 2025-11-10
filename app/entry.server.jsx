import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from "isbot";
import process from "process";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { PassThrough } from "stream";
import { addDocumentResponseHeaders } from "./shopify.server";

// Filtrar logs excesivos de Shopify GraphQL en producción
if (process.env.NODE_ENV === 'production' || process.env.LOG_LEVEL === 'warn') {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  console.log = (...args) => {
    // Filtrar logs que contienen respuestas de GraphQL completas
    const message = args.join(' ');
    if (message.includes('response: Response {') || 
        message.includes('headers: Headers {') ||
        message.includes('status: 200') ||
        message.includes('statusText: \'OK\'')) {
      return; // Suprimir estos logs
    }
    originalConsoleLog.apply(console, args);
  };
  
  console.error = (...args) => {
    // Permitir errores importantes pero filtrar respuestas HTTP completas
    const message = args.join(' ');
    if (message.includes('response: Response {') || 
        message.includes('headers: Headers {')) {
      return; // Suprimir estos logs
    }
    originalConsoleError.apply(console, args);
  };
}

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
