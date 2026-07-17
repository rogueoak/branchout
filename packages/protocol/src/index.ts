// API version prefix (spec 0033) - the single source of truth for the `/v1` path prefix and the
// engine intake subpaths both ends of the report seam share.
export { API_VERSION, V1_PREFIX, ENGINE_ROUNDS_SUBPATH, ENGINE_COMPLETE_SUBPATH } from './api';

// Per-game player limits (spec 0050) - shared by the web lobby and the control-plane so the mode
// picker's clamp and the server's join enforcement use one source of truth.
export { PLAYER_LIMITS, DEFAULT_PLAYER_LIMITS, playerLimits, type PlayerLimits } from './games';

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
  type MoveMessage,
  type MoveRejectedMessage,
  type ClientMessage,
  type EchoMessage,
  type ErrorMessage,
  type IngressMessage,
  type JoinMessage,
  type LeaderboardMessage,
  type PrivateMessage,
  type ProtocolMessage,
  type PromptMessage,
  type RevealMessage,
  type SimMessage,
  type ServerMessage,
  type StateMessage,
  type VoteMessage,
} from './messages';

// Engine-join authentication (spec 0064): the shared HMAC token the control-plane mints over the
// caller's own membership and the engine verifies on the WebSocket `join`, so a device cannot join
// as another player and read their secrets.
export {
  ENGINE_TOKEN_TTL_SECONDS,
  mintEngineToken,
  verifyEngineToken,
  type EngineTokenClaims,
  type EngineTokenError,
  type EngineTokenResult,
} from './engine-auth';

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
