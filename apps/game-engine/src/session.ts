// Session state - the live game, keyed by room + game, held in Redis for the life of the game
// (architecture.md: Redis is the ephemeral store, Postgres the durable one; the engine never
// writes Postgres). The store is an interface so the engine unit-tests against an in-memory fake
// and runs against Redis in production behind the same shape.

import type { RedisClientType } from 'redis';
import type { Phase, RoundReport, ScoreEvent, Standing } from '@branchout/protocol';
import type { SessionPlayer } from './lifecycle';

/** The full live state of one game session. */
export interface SessionState {
  room: string;
  game: string;
  /** Incremented each restart so report ids are unique per run (idempotency). */
  runId: number;
  /**
   * The base seed for this session's worker-built module (spec 0045). Persisted so that if the
   * worker crashes and is respawned, it rebuilds the module with the same seeded rng and the world
   * (rebuilt from `scratch`) is identical. Fixed at start; a restart re-rolls it for a fresh game.
   */
  seed: number;
  phase: Phase;
  paused: boolean;
  round: number;
  rounds: number;
  disputeWindowMs: number;
  /**
   * Guess-window duration in ms for the round in play (0 = no timer / host-advances). Set when the
   * engine enters the `guessing` phase from a module's `reveal` decision (spec 0020); re-armed like
   * the dispute window, not frozen like the move window.
   */
  decisionWindowMs: number;
  /**
   * Move-window duration in ms for the round in play (0 = no timer). The per-round deadline derives
   * from it. A round may override it via `StartRoundResult.moveWindowMs` (spec 0074); when a round
   * does NOT, it resets to {@link baseMoveWindowMs} so an override never sticks past its round.
   */
  moveWindowMs: number;
  /** The configure-time move window (spec 0074): the default a round with no per-round override uses. */
  baseMoveWindowMs: number;
  /**
   * Leaderboard-window duration in ms (spec 0068, 0 = host advances manually). When positive, the
   * engine advances the `leaderboard` phase to the next round after this delay; re-armed across
   * pause/resume like the dispute window, and re-based on the remaining deadline.
   */
  leaderboardWindowMs: number;
  /**
   * True when the module is a continuous / turn-based "live" game (spec 0044): it implements `tick`,
   * sits in one live phase, advances itself on each move, and never uses a host "Next". Fixed at
   * configure from the runtime (`runtime.live`) and surfaced on the `state` frame so the client keeps
   * the host-controls accordion collapsed for a live game (no pending host advance) while leaving it
   * open for a round-based game the host drives. Optional so a session blob persisted before this
   * field loads as `undefined`, read as not-live - the safe default for the round games it predates.
   */
  live?: boolean;
  /**
   * When the current move round auto-closes, as an epoch ms on the engine clock (spec 0017).
   * Set while `collecting` with a timer; cleared once the round closes or while paused (the frozen
   * remaining moves to `moveRemainingMs`).
   */
  moveDeadline?: number;
  /** The move time left, frozen while paused so a resume continues rather than restarting 60s. */
  moveRemainingMs?: number;
  /**
   * When the current dispute/voting/guess/leaderboard window auto-advances, as an epoch ms on the
   * engine clock (spec 0068). Set while a timed window is open; cleared once it advances or while
   * paused (the frozen remaining moves to `windowRemainingMs`). Mirrors `moveDeadline` for the
   * re-armable phase windows so a pause/resume re-bases the deadline rather than restarting it.
   */
  windowDeadline?: number;
  /** The window time left, frozen while paused so a resume continues rather than restarting it. */
  windowRemainingMs?: number;
  /**
   * How many connected players have answered the current `collecting` round (spec 0069), surfaced on
   * the `state` frame as the live "x of y answered" numerator. Refreshed on each accepted move from
   * the module's `answeredCount`, reset to 0 when a new round opens, and undefined for a game that
   * does not report it. Only meaningful while `collecting`; the client ignores it elsewhere.
   */
  answered?: number;
  players: SessionPlayer[];
  scores: Record<string, number>;
  /** Scoring events accumulated for the in-flight round, reported when it finalizes. */
  roundScores: ScoreEvent[];
  /** Players whose results are under dispute in the current round. */
  disputes: string[];
  /**
   * The frames a joining or reconnecting device needs to render the *current* phase, persisted
   * because pub/sub only reaches devices subscribed at publish time (a late joiner missed them).
   * `prompt` is the current round's question, `reveal` its answer/dispute outcome, `standings` the
   * latest leaderboard/final results. Each is replayed on join and cleared when a new round starts.
   */
  prompt?: unknown;
  reveal?: unknown;
  standings?: Standing[];
  /**
   * The latest per-player private (hidden-information) payload for the round in play, keyed by
   * playerId (spec 0052). A game's lifecycle result (`startRound`/`reveal`/`tick`) may carry a
   * `private` map; the engine delivers each entry only to that player's connection(s) over the
   * per-player private channel (never the broadcast channel) and stores it here so a (re)joining
   * device recovers ITS OWN secret as part of join catch-up - it is never used to serve another
   * player's payload. Cleared when a new round starts, mirroring the per-round `reveal`/`standings`
   * pruning, so a stale secret never leaks into a later round. Absent when no game set one.
   */
  privatePayloads?: Record<string, unknown>;
  /**
   * True when the engine auto-paused because the host disconnected (spec 0014), distinct from a
   * deliberate host pause. Only an auto-pause is cleared when the host reconnects, so a manual
   * pause is never silently undone.
   */
  hostPaused: boolean;
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
