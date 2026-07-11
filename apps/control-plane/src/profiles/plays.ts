/**
 * Per-account game history (spec 0027). `room_games.stars` is keyed by the ephemeral `playerId`, so
 * it cannot total a player's stars or list their games; this store records one row per account
 * member of a completed game, keyed by (accountId, gameId), written by the game-complete intake. It
 * is what the public profile's total-stars badge and recent-plays timeline read from.
 */

/** A play to record - the store stamps `playedAt` itself so the caller need not carry a clock. */
export interface NewAccountPlay {
  accountId: string;
  /** The completed game's stable report id - the idempotency key, so a retry never double-counts. */
  gameId: string;
  /** The game type id, e.g. `trivia` / `liar-liar`. */
  game: string;
  /** The player's final rank in that game (competition ranking). */
  rank: number;
  /** Stars earned (the platform rank-to-stars conversion). */
  stars: number;
}

/** A recorded play as read back, with the time it was recorded. */
export interface AccountGamePlay extends NewAccountPlay {
  playedAt: Date;
}

/**
 * Persistence for per-account plays. Behind an interface so the room service and profile reads are
 * testable without a live Postgres: `InMemoryPlaysRepository` backs unit tests,
 * `PostgresPlaysRepository` runs in production.
 */
export interface PlaysRepository {
  /**
   * Record a batch of plays from one completed game. Idempotent per (accountId, gameId): re-recording
   * the same game (a report retry) is a no-op, so stars never double-count.
   */
  recordPlays(plays: readonly NewAccountPlay[]): Promise<void>;
  /** Total stars an account has earned across all recorded games. */
  totalStars(accountId: string): Promise<number>;
  /** The account's most recent plays, newest first, capped at `limit`. */
  recentPlays(accountId: string, limit: number): Promise<AccountGamePlay[]>;
}
