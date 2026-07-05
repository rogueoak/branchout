export {
  ProtocolError,
  parseMessage,
  serializeMessage,
  type EchoMessage,
  type ErrorMessage,
  type ProtocolMessage,
} from './messages';
export type { SocketConnection, SocketServer, SocketServerHandlers } from './adapter';
