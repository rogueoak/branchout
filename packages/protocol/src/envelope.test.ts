import { describe, expect, it } from 'vitest';
import { rankStandings, type PlayerView } from './envelope';

const players: PlayerView[] = [
  { player: 'a', nickname: 'Ada', connected: true },
  { player: 'b', nickname: 'Bo', connected: true },
  { player: 'c', nickname: 'Cy', connected: true },
];

describe('rankStandings', () => {
  it('ranks by score descending', () => {
    const standings = rankStandings(players, { a: 10, b: 30, c: 20 });
    expect(standings.map((s) => [s.player, s.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('shares a rank on a tie and skips the next (competition ranking)', () => {
    const standings = rankStandings(players, { a: 50, b: 50, c: 10 });
    expect(standings.map((s) => [s.player, s.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('treats a missing score as zero', () => {
    const standings = rankStandings(players, { a: 5 });
    const cy = standings.find((s) => s.player === 'c');
    expect(cy?.score).toBe(0);
  });

  it('breaks ties deterministically by player id', () => {
    const first = rankStandings(players, { a: 0, b: 0, c: 0 });
    const second = rankStandings(players, { a: 0, b: 0, c: 0 });
    expect(first).toEqual(second);
    expect(first.map((s) => s.player)).toEqual(['a', 'b', 'c']);
  });
});
