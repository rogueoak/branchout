import { describe, expect, it } from 'vitest';
import { asBramblesSecret, asBramblesSim } from './protocol';

const sim = {
  over: false,
  sprint: 1,
  totalSprints: 6,
  activeTeam: 0,
  guide: 'p1',
  teamScores: [2, 1],
  bloomsThisSprint: 2,
  pricksThisSprint: 1,
  secondsLeft: 45,
  log: [
    { kind: 'clue', text: 'it is tall', player: 'p1' },
    { kind: 'guess', text: 'mountain', player: 'p3' },
  ],
};

describe('asBramblesSim', () => {
  it('decodes a well-formed sim', () => {
    expect(asBramblesSim(sim)).toEqual(sim);
  });

  it('rejects a malformed sim (missing/invalid field) as null', () => {
    expect(asBramblesSim(null)).toBeNull();
    expect(asBramblesSim({ ...sim, activeTeam: 2 })).toBeNull();
    expect(asBramblesSim({ ...sim, teamScores: [1] })).toBeNull();
    expect(asBramblesSim({ ...sim, log: [{ kind: 'nope', text: 'x', player: 'p1' }] })).toBeNull();
  });
});

describe('asBramblesSecret', () => {
  it('decodes a well-formed secret', () => {
    expect(asBramblesSecret({ bloom: 'mountain', thorns: ['peak', 'climb'] })).toEqual({
      bloom: 'mountain',
      thorns: ['peak', 'climb'],
    });
  });

  it('rejects a non-secret payload as null (a non-Guide has none)', () => {
    expect(asBramblesSecret(null)).toBeNull();
    expect(asBramblesSecret({ bloom: 'x' })).toBeNull();
    expect(asBramblesSecret({ bloom: 'x', thorns: [1, 2] })).toBeNull();
  });
});
