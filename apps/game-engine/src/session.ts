// Session state - the live game, keyed by room + game, held in Redis for the life of the game
// (architecture.md: Redis is the ephemeral store, Postgres the durable one; the engine never
// writes Postgres). The store is an interface so the engine unit-tests against an in-memory fake
// and runs against Redis in production behind the same shape.

import type { RedisClientType } from 'redis';
import type { Phase, RoundReport, ScoreEvent } from '@branchout/protocol';
import type { SessionPlayer } from './lifecycle';

/** The full live state of one game session. */
export interface SessionState {
  room: string;
  game: string;
  /** Incremented each restart so report ids are unique per run (idempotency). */
  runId: number;
  phase: Phase;
  paused: boolean;
  round: number;
  rounds: number;
  disputeWindowMs: number;
  players: SessionPlayer[];
  scores: Record<string, number>;
  /** Scoring events accumulated for the in-flight round, reported when it finalizes. */
  roundScores: ScoreEvent[];
  /** Players whose results are under dispute in the current round. */
  disputes: string[];
  /** Module-owned scratch space. Opaque to the engine. */
  scratch: Record<string, unknown>;
  /** The opaque config the control-plane handed in. */
  config: unknown;
  /** roundIds already reported, so a retry never double-bills. */
  reportedRounds: string[];
  /** Round reports whose delivery failed; retried on the next finalize/endGame (an outbox). */
  pendingRounds: RoundReport[];
  /** True once the game-complete report was accepted. */
  completeReported: boolean;
}

export interface SessionStore {
  load(room: string, game: string): Promise<SessionState | null>;
  save(state: SessionState): Promise<void>;
  delete(room: string, game: string): Promise<void>;
}

/** Redis key for a session. One flat JSON blob per game keeps reads/writes atomic per session. */
export function sessionKey(room: string, game: string): string {
  return `session:${room}:${game}`;
}

/**
 * Seconds a finished (`complete`) session lingers in Redis before it expires. Long enough for a
 * device to reconnect and read final standings, short enough that dead games do not accumulate.
 */
export const COMPLETE_SESSION_TTL_SECONDS = 60 * 60;

/** Redis-backed store: the session is a single JSON blob under its key. */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly client: RedisClientType) {}

  async load(room: string, game: string): Promise<SessionState | null> {
    const raw = await this.client.get(sessionKey(room, game));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  }

  async save(state: SessionState): Promise<void> {
    // A live session persists; a completed one gets a TTL so it self-cleans if never restarted.
    const options = state.phase === 'complete' ? { EX: COMPLETE_SESSION_TTL_SECONDS } : undefined;
    await this.client.set(sessionKey(state.room, state.game), JSON.stringify(state), options);
  }

  async delete(room: string, game: string): Promise<void> {
    await this.client.del(sessionKey(room, game));
  }
}

/** In-memory store for tests and single-process dev. Deep-clones on read/write to mimic Redis. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, string>();

  async load(room: string, game: string): Promise<SessionState | null> {
    const raw = this.sessions.get(sessionKey(room, game));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  }

  async save(state: SessionState): Promise<void> {
    this.sessions.set(sessionKey(state.room, state.game), JSON.stringify(state));
  }

  async delete(room: string, game: string): Promise<void> {
    this.sessions.delete(sessionKey(room, game));
  }
}
