// The player <-> engine WebSocket wire protocol. Every game frame is a versioned envelope keyed
// by room + game (and, for client frames, the player). Two transport frames remain from the
// scaffold: `echo` (proves the transport end to end) and `error` (the server's reply to a frame
// it cannot understand).
//
// Client -> server: join, move, vote. Server -> client: prompt, reveal, leaderboard, state.

import {
  PROTOCOL_VERSION,
  ProtocolError,
  assertVersion,
  isRecord,
  requireBool,
  requireId,
  requireInt,
  requireString,
  type Phase,
  type PlayerView,
  type Standing,
} from './envelope';

// --- transport frames (unversioned; pure plumbing) ---

export interface EchoMessage {
  type: 'echo';
  payload: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

// --- client -> server (each carries the acting player) ---

/** A device joins a session and binds to a room/game/player identity. */
export interface JoinMessage {
  v: number;
  type: 'join';
  room: string;
  game: string;
  player: string;
  nickname: string;
  /**
   * A short-lived, per-connection auth token proving this device is the claimed `player` (spec
   * 0064). The control-plane mints it over the caller's OWN membership (session -> playerId), so a
   * device can only ever get a token for its own id. The engine verifies the HMAC binds this exact
   * `{room, game, player}` and is unexpired before honouring the join. Optional/additive under the
   * same `PROTOCOL_VERSION`: a peer predating it still parses a valid `join` frame, and the engine
   * only REQUIRES it when `ENGINE_AUTH_SECRET` is configured (always in dev/e2e/prod; unset only in
   * pure-unit tests that never touch the auth path).
   */
  token?: string;
}

/** A player submits their move for the current round. */
export interface MoveMessage {
  v: number;
  type: 'move';
  room: string;
  game: string;
  player: string;
  round: number;
  move: string;
}

/**
 * A player casts a vote. The engine forwards it to the game module for the current phase, so the
 * same frame serves both raising a dispute (`target` is the voter) and voting on one (`target`
 * is the disputer). The module owns what a vote means.
 */
export interface VoteMessage {
  v: number;
  type: 'vote';
  room: string;
  game: string;
  player: string;
  round: number;
  target: string;
  agree: boolean;
}

export type ClientMessage = JoinMessage | MoveMessage | VoteMessage;

// --- server -> client (broadcasts keyed by room/game) ---

/** The prompt for a round. `prompt` is opaque, game-defined payload. */
export interface PromptMessage {
  v: number;
  type: 'prompt';
  room: string;
  game: string;
  round: number;
  phase: Phase;
  prompt: unknown;
}

/** The reveal/score result of a round. `reveal` is opaque, game-defined payload. */
export interface RevealMessage {
  v: number;
  type: 'reveal';
  room: string;
  game: string;
  round: number;
  reveal: unknown;
}

/**
 * The engine's reply refusing one player's submission (e.g. a duplicate or the correct answer in a
 * bluffing game). Unlike every other server frame this is a *targeted* reply sent only to the
 * submitting device, never broadcast over pub/sub, so no other player learns a fake was rejected.
 * The `reason` is deliberately vague ("someone already submitted that"). Additive, server->client
 * only (never parsed off the wire), under the same `PROTOCOL_VERSION`.
 */
export interface MoveRejectedMessage {
  v: number;
  type: 'move_rejected';
  room: string;
  game: string;
  round: number;
  reason: string;
}

/**
 * A per-player secret payload (hidden information: a spymaster key, a hidden role, a private hand).
 * Targeted, sent only to the recipient's device(s), never broadcast over pub/sub, so no other player
 * receives it. `private` is opaque, game-defined. Additive, server -> client only (never parsed off
 * the wire), under the same PROTOCOL_VERSION.
 */
export interface PrivateMessage {
  v: number;
  type: 'private';
  room: string;
  game: string;
  round: number;
  player: string; // the recipient; echoed so the client can confirm the target is itself
  private: unknown;
}

/**
 * A live simulation snapshot for a continuous ("live") game, streamed at a fixed cadence while the
 * world is in motion (spec 0044). `sim` is opaque, game-defined payload - for a physics game the
 * current tower (body transforms + geometry) plus its HUD. Unlike `reveal` (which accumulates), a
 * reader REPLACES its live state from each `sim` frame, so a precarious tower streams its sway.
 * Server -> client only, never parsed off the wire, under the same `PROTOCOL_VERSION`.
 */
export interface SimMessage {
  v: number;
  type: 'sim';
  room: string;
  game: string;
  sim: unknown;
}

/** The current standings, streamed between rounds and on demand. */
export interface LeaderboardMessage {
  v: number;
  type: 'leaderboard';
  room: string;
  game: string;
  standings: Standing[];
}

/** A full snapshot of the session: phase, players, and scores. Sent on join for recovery. */
export interface StateMessage {
  v: number;
  type: 'state';
  room: string;
  game: string;
  phase: Phase;
  paused: boolean;
  round: number;
  players: PlayerView[];
  scores: Record<string, number>;
  /**
   * The playerIds who raised a dispute in the round currently in play (empty until someone does,
   * reset when the next round starts). The vote UI reads it during the `voting` phase to name
   * exactly the disputers instead of guessing from the wrong-answer set. Carries playerIds, the
   * same identity space as `players[].player`.
   *
   * Optional on the wire so this stays an additive, backward-compatible change under the same
   * `PROTOCOL_VERSION`: a peer predating this field still parses as a valid `state` frame, and a
   * reader must treat its absence as "no disputers" (default to `[]` at the boundary). The engine
   * always populates it.
   */
  disputes?: string[];
  /**
   * Milliseconds left in the move window for the round in play, or absent when there is no timer
   * (spec 0017). Sent as *remaining* rather than an absolute deadline so a client anchors it to its
   * own clock (`Date.now() + moveMsRemaining`), immune to client/server clock skew, and a
   * reconnecting device gets the true time left. While paused it carries the frozen remaining.
   *
   * Optional/additive under the same `PROTOCOL_VERSION`: a peer predating it still parses a valid
   * `state` frame, and a reader treats its absence as "no move timer".
   */
  moveMsRemaining?: number;
}

export type ServerMessage =
  | PromptMessage
  | RevealMessage
  | SimMessage
  | LeaderboardMessage
  | StateMessage
  | MoveRejectedMessage
  | PrivateMessage;

export type ProtocolMessage = EchoMessage | ErrorMessage | ClientMessage | ServerMessage;

/** The frames the engine accepts on ingress - exactly what {@link parseMessage} yields. */
export type IngressMessage = EchoMessage | ClientMessage;

/** Encode a protocol message for the wire. */
export function serializeMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

function parseJoin(data: Record<string, unknown>): JoinMessage {
  // `token` (spec 0064) is optional and additive: present it as a string when the client sends one,
  // omit it otherwise. A non-string token is ignored here (dropped to undefined) rather than a parse
  // error, so a malformed token becomes a clean "missing token" auth rejection in the engine rather
  // than a transport-level failure - the auth boundary is the one that decides, not the parser.
  const token = typeof data.token === 'string' ? data.token : undefined;
  return {
    v: PROTOCOL_VERSION,
    type: 'join',
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    player: requireId(data, 'player'),
    nickname: requireString(data, 'nickname'),
    ...(token !== undefined ? { token } : {}),
  };
}

function parseMove(data: Record<string, unknown>): MoveMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'move',
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    player: requireId(data, 'player'),
    round: requireInt(data, 'round'),
    move: requireString(data, 'move'),
  };
}

function parseVote(data: Record<string, unknown>): VoteMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'vote',
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    player: requireId(data, 'player'),
    round: requireInt(data, 'round'),
    target: requireId(data, 'target'),
    agree: requireBool(data, 'agree'),
  };
}

/**
 * Decode and validate a raw wire frame from a client. Throws {@link ProtocolError} on anything
 * that is not a well-formed client message, so callers never see a half-parsed object.
 *
 * Only the frames the engine accepts on ingress (echo, join, move, vote) are validated here;
 * server-bound frames are constructed by the engine, never parsed off the wire.
 */
export function parseMessage(raw: string): IngressMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ProtocolError('message is not valid JSON');
  }

  if (!isRecord(data) || typeof data.type !== 'string') {
    throw new ProtocolError('message is missing a string "type"');
  }

  // Transport frame: unversioned, no room/game key.
  if (data.type === 'echo') {
    if (typeof data.payload !== 'string') {
      throw new ProtocolError('echo message needs a string "payload"');
    }
    return { type: 'echo', payload: data.payload };
  }

  // Every game frame is versioned; check that before trusting the rest of its shape.
  assertVersion(data.v);

  switch (data.type) {
    case 'join':
      return parseJoin(data);
    case 'move':
      return parseMove(data);
    case 'vote':
      return parseVote(data);
    default:
      throw new ProtocolError(`unknown message type: ${String(data.type)}`);
  }
}
