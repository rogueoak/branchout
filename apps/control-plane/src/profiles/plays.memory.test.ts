import { describe, expect, it } from 'vitest';
import { InMemoryPlaysRepository } from './plays.memory';

describe('InMemoryPlaysRepository', () => {
  it('totals stars across recorded games for an account', async () => {
    const plays = new InMemoryPlaysRepository();
    await plays.recordPlays([
      { accountId: 'a1', gameId: 'g1', game: 'trivia', rank: 1, stars: 3 },
      { accountId: 'a1', gameId: 'g2', game: 'trivia', rank: 2, stars: 2 },
      { accountId: 'a2', gameId: 'g1', game: 'trivia', rank: 2, stars: 2 },
    ]);
    expect(await plays.totalStars('a1')).toBe(5);
    expect(await plays.totalStars('a2')).toBe(2);
    expect(await plays.totalStars('nobody')).toBe(0);
  });

  it('is idempotent per (account, game): re-recording a game does not double-count', async () => {
    const plays = new InMemoryPlaysRepository();
    const batch = [{ accountId: 'a1', gameId: 'g1', game: 'trivia', rank: 1, stars: 3 }];
    await plays.recordPlays(batch);
    await plays.recordPlays(batch); // a report retry
    expect(await plays.totalStars('a1')).toBe(3);
    expect(await plays.recentPlays('a1', 10)).toHaveLength(1);
  });

  it('returns recent plays newest-first, capped at the limit', async () => {
    const plays = new InMemoryPlaysRepository();
    for (let i = 1; i <= 5; i += 1) {
      await plays.recordPlays([
        { accountId: 'a1', gameId: `g${i}`, game: 'trivia', rank: 1, stars: 3 },
      ]);
    }
    const recent = await plays.recentPlays('a1', 3);
    expect(recent).toHaveLength(3);
    // Newest first: g5 was recorded last.
    expect(recent[0]!.gameId).toBe('g5');
  });
});
