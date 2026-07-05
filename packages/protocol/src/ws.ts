import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SocketConnection, SocketServer, SocketServerHandlers } from './adapter';
import { parseMessage, serializeMessage } from './messages';

/**
 * Max bytes accepted per frame. `ws` defaults to ~100 MiB, so an anonymous client could pin
 * memory with one big frame; game messages are small, so cap it. Bump per game if needed.
 */
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface CreateWsServerOptions {
  /** Override the per-frame byte cap. */
  maxPayload?: number;
}

/**
 * Attach a `ws`-backed realtime server to an existing HTTP server and adapt it to the
 * transport-agnostic {@link SocketServerHandlers} surface. Invalid frames get an error frame
 * back by default so a bad client cannot silently wedge a connection.
 *
 * Note: this does not gate connections by Origin. Cross-site WebSocket hijacking is not a risk
 * while the endpoint carries no ambient-authority session; add an Origin/token check here once
 * the control-plane hands the engine authenticated sessions (later spec).
 */
export function createWsServer(
  server: HttpServer,
  handlers: SocketServerHandlers,
  options: CreateWsServerOptions = {},
): SocketServer {
  const wss = new WebSocketServer({
    server,
    maxPayload: options.maxPayload ?? DEFAULT_MAX_PAYLOAD_BYTES,
  });

  const reportError = (connection: SocketConnection, error: Error) => {
    if (handlers.onError) {
      handlers.onError(connection, error);
    } else {
      console.error('[protocol/ws] socket error', error);
    }
  };

  wss.on('connection', (socket: WebSocket) => {
    const connection: SocketConnection = {
      send: (message) => socket.send(serializeMessage(message)),
      close: (code) => socket.close(code),
    };

    // Without a per-socket 'error' listener, a transport error (e.g. ECONNRESET) is emitted as
    // an unhandled 'error' event and crashes the process.
    socket.on('error', (error) => reportError(connection, error));

    handlers.onConnection?.(connection);

    socket.on('message', (data) => {
      let message;
      try {
        message = parseMessage(data.toString());
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        // A malformed frame is a client mistake, not a transport failure: answer with an error
        // frame rather than routing it to the transport-error handler.
        connection.send({ type: 'error', message: err.message });
        return;
      }
      handlers.onMessage?.(connection, message);
    });

    socket.on('close', () => handlers.onClose?.(connection));
  });

  // A server-level error (e.g. the HTTP upgrade path) must not crash the process either.
  wss.on('error', (error) => console.error('[protocol/ws] server error', error));

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
