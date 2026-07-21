// The engine <-> control-plane server-to-server channel, carried over internal REST (see spec
// 0007 Approach for the transport decision: REST over a queue, made idempotent with ids so a
// retry never double-bills). Three calls:
//
//   - start handoff   control-plane -> engine   POST /sessions
//   - round result    engine -> control-plane   POST /rounds
//   - game complete   engine -> control-plane   POST /games/complete
//
// Each envelope is versioned like the WebSocket channel, and each report carries a stable id so
// the receiver can dedupe.

import {
  PROTOCOL_VERSION,
  assertVersion,
  isRecord,
  requireId,
  requireInt,
  requireString,
  ProtocolError,
  type ScoreEvent,
  type Standing,
} from './envelope';
import { isPaletteId } from './palettes';

/** A player handed to the engine at start: identity + display name. */
export interface HandoffPlayer {
  player: string;
  nickname: string;
  /**
   * True for the room host. Optional and defaulted-absent (additive under the same protocol
   * version): the engine treats a missing flag as `false`. The engine uses it to auto-pause the
   * game while the host is disconnected (spec 0014).
   */
  isHost?: boolean;
  /**
   * The palette id this player reserved in the lobby (spec 0063, Sketchy palettes). Optional and
   * defaulted-absent (additive under the same protocol version): a game that does not use palettes
   * (and an older control-plane) simply omits it, and the engine treats it as "no palette". Sketchy
   * uses it to validate a player's strokes against only their three claimed colors.
   */
  paletteId?: string;
}

/**
 * The control-plane hands a room, a selected game module, and an opaque config to the engine.
 * `config` is validated by the game module, not here - the control-plane passes it through
 * unchanged (spec 0006). Idempotent on `room` + `game`: re-posting a running session is a no-op.
 */
export interface StartHandoffRequest {
  v: number;
  room: string;
  game: string;
  players: HandoffPlayer[];
  config: unknown;
}

export interface StartHandoffResponse {
  v: number;
  room: string;
  game: string;
  /** `started` on first handoff, `running` when the session already existed (idempotent). */
  status: 'started' | 'running';
}

/**
 * The engine reports a finished round. `roundId` is the idempotency key (stable per room + game
 * + round), so the control-plane debits the round's credit exactly once even if the call retries.
 */
export interface RoundReport {
  v: number;
  room: string;
  game: string;
  round: number;
  roundId: string;
  scores: ScoreEvent[];
  standings: Standing[];
}

/** The engine reports final standings. `gameId` dedupes the completion (stars awarded once). */
export interface GameCompleteReport {
  v: number;
  room: string;
  game: string;
  gameId: string;
  standings: Standing[];
}

/** The control-plane's reply to either report: `recorded` first time, `duplicate` on a retry. */
export interface ReportAck {
  v: number;
  status: 'recorded' | 'duplicate';
}

function requirePlayers(data: Record<string, unknown>): HandoffPlayer[] {
  const raw = data.players;
  if (!Array.isArray(raw)) {
    throw new ProtocolError('"players" must be an array');
  }
  return raw.map((entry) => {
    if (!isRecord(entry)) {
      throw new ProtocolError('each player must be an object');
    }
    return {
      player: requireId(entry, 'player'),
      nickname: requireString(entry, 'nickname'),
      // Carry the optional host flag through ingress validation; absent stays absent so a peer
      // predating the field is unchanged (spec 0014). Dropping it here would silently un-host the
      // roster no matter what the sender set.
      ...(typeof entry.isHost === 'boolean' ? { isHost: entry.isHost } : {}),
      // Carry the optional palette id through the same way (spec 0063): absent stays absent so a
      // palette-less game / an older sender is unchanged. Validate it against the known palettes at
      // this trust boundary, so a stale/garbage id degrades to the documented no-palette path (the
      // engine's lenient union) rather than entering the engine and dropping every one of that
      // player's strokes.
      ...(isPaletteId(entry.paletteId) ? { paletteId: entry.paletteId } : {}),
    };
  });
}

function requireScores(data: Record<string, unknown>): ScoreEvent[] {
  const raw = data.scores;
  if (!Array.isArray(raw)) {
    throw new ProtocolError('"scores" must be an array');
  }
  return raw.map((entry) => {
    if (!isRecord(entry)) {
      throw new ProtocolError('each score event must be an object');
    }
    return {
      player: requireString(entry, 'player'),
      points: requireInt(entry, 'points'),
      reason: requireString(entry, 'reason'),
    };
  });
}

function requireStandings(data: Record<string, unknown>): Standing[] {
  const raw = data.standings;
  if (!Array.isArray(raw)) {
    throw new ProtocolError('"standings" must be an array');
  }
  return raw.map((entry) => {
    if (!isRecord(entry)) {
      throw new ProtocolError('each standing must be an object');
    }
    return {
      player: requireString(entry, 'player'),
      nickname: requireString(entry, 'nickname'),
      score: requireInt(entry, 'score'),
      rank: requireInt(entry, 'rank'),
    };
  });
}

function asEnvelope(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new ProtocolError('report must be an object');
  }
  assertVersion(raw.v);
  return raw;
}

/** Validate a start-handoff request body (control-plane -> engine ingress). */
export function parseStartHandoff(raw: unknown): StartHandoffRequest {
  const data = asEnvelope(raw);
  return {
    v: PROTOCOL_VERSION,
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    players: requirePlayers(data),
    config: data.config,
  };
}

/** Validate a round report body (engine -> control-plane ingress). */
export function parseRoundReport(raw: unknown): RoundReport {
  const data = asEnvelope(raw);
  return {
    v: PROTOCOL_VERSION,
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    round: requireInt(data, 'round'),
    roundId: requireString(data, 'roundId'),
    scores: requireScores(data),
    standings: requireStandings(data),
  };
}

/** Validate a game-complete report body (engine -> control-plane ingress). */
export function parseGameCompleteReport(raw: unknown): GameCompleteReport {
  const data = asEnvelope(raw);
  return {
    v: PROTOCOL_VERSION,
    room: requireId(data, 'room'),
    game: requireId(data, 'game'),
    gameId: requireString(data, 'gameId'),
    standings: requireStandings(data),
  };
}
