// Shared domain types and version stamp.
export {
  PROTOCOL_VERSION,
  ProtocolError,
  rankStandings,
  type Phase,
  type PlayerView,
  type ScoreEvent,
  type Standing,
} from './envelope';

// Player <-> engine WebSocket channel.
export {
  parseMessage,
  serializeMessage,
  type AnswerMessage,
  type AnswerRejectedMessage,
  type ClientMessage,
  type EchoMessage,
  type ErrorMessage,
  type IngressMessage,
  type JoinMessage,
  type LeaderboardMessage,
  type ProtocolMessage,
  type PromptMessage,
  type RevealMessage,
  type ServerMessage,
  type StateMessage,
  type VoteMessage,
} from './messages';

// Engine <-> control-plane server-to-server channel.
export {
  parseGameCompleteReport,
  parseRoundReport,
  parseStartHandoff,
  type GameCompleteReport,
  type HandoffPlayer,
  type ReportAck,
  type RoundReport,
  type StartHandoffRequest,
  type StartHandoffResponse,
} from './reporting';

// Transport-agnostic realtime adapter surface (concrete `ws` impl in ./ws).
export type { SocketConnection, SocketServer, SocketServerHandlers } from './adapter';
