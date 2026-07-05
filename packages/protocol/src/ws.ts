import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SocketConnection, SocketServer, SocketServerHandlers } from './adapter';
import { parseMessage, serializeMessage } from './messages';

/**
 * Attach a `ws`-backed realtime server to an existing HTTP server and adapt it to the
 * transport-agnostic {@link SocketServerHandlers} surface. Invalid frames get an error frame
 * back by default so a bad client cannot silently wedge a connection.
 */
export function createWsServer(server: HttpServer, handlers: SocketServerHandlers): SocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket: WebSocket) => {
    const connection: SocketConnection = {
      send: (message) => socket.send(serializeMessage(message)),
      close: (code) => socket.close(code),
    };

    handlers.onConnection?.(connection);

    socket.on('message', (data) => {
      let message;
      try {
        message = parseMessage(data.toString());
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (handlers.onError) {
          handlers.onError(connection, err);
        } else {
          connection.send({ type: 'error', message: err.message });
        }
        return;
      }
      handlers.onMessage?.(connection, message);
    });

    socket.on('close', () => handlers.onClose?.(connection));
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
