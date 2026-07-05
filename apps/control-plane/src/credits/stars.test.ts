import type { Standing } from '@branchout/protocol';
import { describe, expect, it } from 'vitest';
import { standingsToStars, starsForRank } from './stars';

function standing(player: string, score: number, rank: number): Standing {
  return { player, nickname: player, score, rank };
}

describe('stars conversion', () => {
  it('maps ranks 1/2/3 to 3/2/1 stars and 4th+ to none', () => {
    expect(starsForRank(1)).toBe(3);
    expect(starsForRank(2)).toBe(2);
    expect(starsForRank(3)).toBe(1);
    expect(starsForRank(4)).toBe(0);
    expect(starsForRank(9)).toBe(0);
  });

  it('converts a full standings table', () => {
    const standings = [standing('a', 30, 1), standing('b', 20, 2), standing('c', 10, 3)];
    expect(standingsToStars(standings)).toEqual([
      { player: 'a', nickname: 'a', rank: 1, stars: 3 },
      { player: 'b', nickname: 'b', rank: 2, stars: 2 },
      { player: 'c', nickname: 'c', rank: 3, stars: 1 },
    ]);
  });

  it('gives tied winners equal stars, skipping the shared rank (competition ranking)', () => {
    // Two players tie for first (both rank 1); the next is rank 3, not rank 2.
    const standings = [standing('a', 30, 1), standing('b', 30, 1), standing('c', 10, 3)];
    const awards = standingsToStars(standings);
    expect(awards[0]!.stars).toBe(3);
    expect(awards[1]!.stars).toBe(3);
    // The player at rank 3 earns 1 star; the skipped rank 2 is awarded to nobody.
    expect(awards[2]).toMatchObject({ rank: 3, stars: 1 });
  });

  it('gives a three-way tie for second equal 2-star awards', () => {
    const standings = [
      standing('a', 50, 1),
      standing('b', 20, 2),
      standing('c', 20, 2),
      standing('d', 20, 2),
    ];
    const awards = standingsToStars(standings);
    expect(awards.map((a) => a.stars)).toEqual([3, 2, 2, 2]);
  });
});
