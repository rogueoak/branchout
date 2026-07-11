import type { AccountGamePlay, NewAccountPlay, PlaysRepository } from './plays';

/**
 * In-memory plays store for tests. Mirrors the Postgres store's idempotency: a (accountId, gameId)
 * already recorded is skipped, so re-recording a completed game (a report retry) never double-counts.
 */
export class InMemoryPlaysRepository implements PlaysRepository {
  private readonly rows: (AccountGamePlay & { seq: number })[] = [];
  private seq = 0;

  async recordPlays(plays: readonly NewAccountPlay[]): Promise<void> {
    for (const play of plays) {
      const exists = this.rows.some(
        (row) => row.accountId === play.accountId && row.gameId === play.gameId,
      );
      if (!exists) {
        this.rows.push({ ...play, playedAt: new Date(), seq: ++this.seq });
      }
    }
  }

  async totalStars(accountId: string): Promise<number> {
    return this.rows
      .filter((row) => row.accountId === accountId)
      .reduce((sum, row) => sum + row.stars, 0);
  }

  async recentPlays(accountId: string, limit: number): Promise<AccountGamePlay[]> {
    // Order by recorded time, then insertion sequence, so ties within a millisecond stay
    // deterministically newest-first (matching Postgres ORDER BY played_at DESC in practice).
    return this.rows
      .filter((row) => row.accountId === accountId)
      .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime() || b.seq - a.seq)
      .slice(0, limit)
      .map((row) => ({
        accountId: row.accountId,
        gameId: row.gameId,
        game: row.game,
        rank: row.rank,
        stars: row.stars,
        playedAt: row.playedAt,
      }));
  }
}
