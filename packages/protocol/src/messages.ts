// The player <-> engine WebSocket wire protocol. Every game frame is a versioned envelope keyed
// by room + game (and, for client frames, the player). Two transport frames remain from the
// scaffold: `echo` (proves the transport end to end) and `error` (the server's reply to a frame
// it cannot understand).
//
// Client -> server: join, answer, vote. Server -> client: prompt, reveal, leaderboard, state.

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
}

/** A player submits their answer for the current round. */
export interface AnswerMessage {
  v: number;
  type: 'answer';
  room: string;
  game: string;
  player: string;
  round: number;
  answer: string;
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

export type ClientMessage = JoinMessage | AnswerMessage | VoteMessage;

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
}

export type ServerMessage = PromptMessage | RevealMessage | LeaderboardMessage | StateMessage;

export type ProtocolMessage = EchoMessage | ErrorMessage | ClientMessage | ServerMessage;

/** The frames the engine accepts on ingress - exactly what {@link parseMessage} yields. */
export type IngressMessage = EchoMessage | ClientMessage;

/** Encode a protocol message for the wire. */
export function serializeMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

function parseJoin(data: Record<string, unknown>): JoinMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'join',
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    player: requireId(data, 'player'),
    nickname: requireString(data, 'nickname'),
  };
}

function parseAnswer(data: Record<string, unknown>): AnswerMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'answer',
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    player: requireId(data, 'player'),
    round: requireInt(data, 'round'),
    answer: requireString(data, 'answer'),
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
 * Only the frames the engine accepts on ingress (echo, join, answer, vote) are validated here;
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
    case 'answer':
      return parseAnswer(data);
    case 'vote':
      return parseVote(data);
    default:
      throw new ProtocolError(`unknown message type: ${String(data.type)}`);
  }
}
