import type { ProtocolMessage } from './messages';

// A transport-agnostic surface over a realtime connection. game-engine talks to this, not to
// `ws` directly, so the transport (ws, Socket.IO, raw TCP, ...) can change without touching
// game logic. The concrete `ws` implementation lives in `./ws`.

/** One live client connection. */
export interface SocketConnection {
  /** Send a protocol message to this client. */
  send(message: ProtocolMessage): void;
  /** Close the connection, optionally with a WebSocket close code. */
  close(code?: number): void;
}

/** Callbacks the server wires up once; the adapter invokes them per connection. */
export interface SocketServerHandlers {
  /** A client connected. */
  onConnection?(connection: SocketConnection): void;
  /** A valid protocol message arrived from a client. */
  onMessage?(connection: SocketConnection, message: ProtocolMessage): void;
  /**
   * A transport-level error occurred on this connection (e.g. ECONNRESET). Without this the
   * adapter logs it. Malformed client frames are not routed here - the adapter answers those
   * with an error frame - so this only fires for genuine connection failures.
   */
  onError?(connection: SocketConnection, error: Error): void;
  /** A client disconnected. */
  onClose?(connection: SocketConnection): void;
}

/** A running realtime server bound to an HTTP server. */
export interface SocketServer {
  /** Stop accepting connections and close the server. */
  close(): Promise<void>;
}
