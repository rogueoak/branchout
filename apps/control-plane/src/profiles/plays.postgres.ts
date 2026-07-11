import type { Pool } from 'pg';
import type { AccountGamePlay, NewAccountPlay, PlaysRepository } from './plays';

interface PlayRow {
  account_id: string;
  game_id: string;
  game: string;
  rank: number;
  stars: number;
  played_at: Date;
}

/** Postgres-backed per-account plays store. All queries are parameterized - never string-built. */
export class PostgresPlaysRepository implements PlaysRepository {
  constructor(private readonly pool: Pool) {}

  async recordPlays(plays: readonly NewAccountPlay[]): Promise<void> {
    // Idempotent per (account_id, game_id) - the table's primary key - so a report retry that
    // re-records a completed game never double-counts stars (the money/idempotency learning).
    for (const play of plays) {
      await this.pool.query(
        `INSERT INTO account_game_plays (account_id, game_id, game, rank, stars)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, game_id) DO NOTHING`,
        [play.accountId, play.gameId, play.game, play.rank, play.stars],
      );
    }
  }

  async totalStars(accountId: string): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(stars), 0)::int AS total FROM account_game_plays WHERE account_id = $1`,
      [accountId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async recentPlays(accountId: string, limit: number): Promise<AccountGamePlay[]> {
    const result = await this.pool.query<PlayRow>(
      `SELECT account_id, game_id, game, rank, stars, played_at
         FROM account_game_plays
        WHERE account_id = $1
        ORDER BY played_at DESC
        LIMIT $2`,
      [accountId, limit],
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      gameId: row.game_id,
      game: row.game,
      rank: row.rank,
      stars: row.stars,
      playedAt: row.played_at,
    }));
  }
}
