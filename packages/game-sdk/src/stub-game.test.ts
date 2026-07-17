import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from './lifecycle';
import { stubGame, stubPlugin } from './stub-game';
import { createTestServices } from './testing';

const players: SessionPlayer[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
];

function ctx(overrides: Partial<RoundContext> = {}): RoundContext {
  return {
    room: 'r1',
    game: 'stub',
    phase: 'collecting',
    round: 1,
    players,
    scores: { p1: 0, p2: 0 },
    scratch: {},
    config: { rounds: 1, secrets: ['blue'] },
    ...overrides,
  };
}

describe('stubGame.configure', () => {
  it('defaults to 3 rounds and derives rounds from secrets', () => {
    expect(stubGame.configure({}, players).rounds).toBe(3);
    expect(stubGame.configure({ secrets: ['a', 'b'] }, players).rounds).toBe(2);
  });

  it('rejects a non-positive round count', () => {
    expect(() => stubGame.configure({ rounds: 0 }, players)).toThrow();
    expect(() => stubGame.configure({ rounds: -1 }, players)).toThrow();
  });
});

describe('stubGame reveal scoring', () => {
  it('awards 100 for a normalized-correct answer and nothing otherwise', () => {
    const scratch = stubGame.configure({ secrets: ['Blue'] }, players).scratch;
    let s = stubGame.collectMove(ctx({ scratch }), 'p1', '  BLUE ').scratch;
    s = stubGame.collectMove(ctx({ scratch: s }), 'p2', 'red').scratch;
    const reveal = stubGame.reveal(ctx({ scratch: s }));
    expect(reveal.scores).toEqual([{ player: 'p1', points: 100, reason: 'correct answer' }]);
  });
});

describe('stubGame private payloads (spec 0052)', () => {
  it('returns no private map by default (unchanged no-secret path)', () => {
    const scratch = stubGame.configure({ secrets: ['blue'] }, players).scratch;
    expect(stubGame.startRound(ctx({ scratch })).private).toBeUndefined();
  });

  it('deals the configured per-round per-player secret map at round start', () => {
    const scratch = stubGame.configure(
      { secrets: ['blue', 'green'], privates: [{ p1: 'secretA', p2: 'secretB' }, { p1: 'r2A' }] },
      players,
    ).scratch;
    expect(stubGame.startRound(ctx({ scratch, round: 1 })).private).toEqual({
      p1: 'secretA',
      p2: 'secretB',
    });
    // Round 2's map is distinct, so a later round never re-serves round 1's secrets.
    expect(stubGame.startRound(ctx({ scratch, round: 2 })).private).toEqual({ p1: 'r2A' });
  });
});

describe('stubGame end ranking', () => {
  it('ranks final standings by score with shared ranks on ties', () => {
    const standings = stubGame.endGame(ctx({ scores: { p1: 100, p2: 100 } }));
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });
});

describe('stubPlugin', () => {
  it('exposes a manifest whose id matches the module and builds the module via create', async () => {
    expect(stubPlugin.manifest.id).toBe('stub');
    const module = await stubPlugin.create(createTestServices());
    expect(module.id).toBe(stubPlugin.manifest.id);
    expect(module).toBe(stubGame);
  });
});
