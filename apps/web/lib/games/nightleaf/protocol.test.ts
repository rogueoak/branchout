import { describe, expect, it } from 'vitest';
import { asNightleafHand, asNightleafSim, encodeMove, type NightleafSim } from './protocol';

const sim: NightleafSim = {
  tier: 2,
  finalTier: 4,
  buds: 3,
  maxBuds: 3,
  fireflies: 1,
  trunk: [4, 12],
  top: 12,
  hands: [
    { player: 'a', nickname: 'Ada', count: 1 },
    { player: 'b', nickname: 'Bo', count: 2 },
  ],
  leavesLeft: 3,
  hushProposers: ['a'],
  over: false,
  won: false,
  phase: 'playing',
  lastMisplay: null,
};

describe('asNightleafSim', () => {
  it('decodes a well-formed shared snapshot', () => {
    expect(asNightleafSim(sim)).toEqual(sim);
  });

  it('defaults an unknown/absent phase to playing rather than nulling the frame', () => {
    const decoded = asNightleafSim({ ...sim, phase: 'bogus' });
    expect(decoded?.phase).toBe('playing');
  });

  it('decodes a misplay banner detail', () => {
    const decoded = asNightleafSim({
      ...sim,
      phase: 'misplay',
      lastMisplay: { played: 12, lowestHeld: 5 },
    });
    expect(decoded?.lastMisplay).toEqual({ played: 12, lowestHeld: 5 });
  });

  it('returns null for a non-object or a shape mismatch', () => {
    expect(asNightleafSim(null)).toBeNull();
    expect(asNightleafSim('x')).toBeNull();
    expect(asNightleafSim({ ...sim, trunk: 'nope' })).toBeNull();
    expect(asNightleafSim({ ...sim, hands: [{ player: 'a' }] })).toBeNull();
  });
});

describe('asNightleafHand', () => {
  it('decodes a well-formed private hand', () => {
    expect(asNightleafHand({ leaves: [5, 40, 88], lowest: 5 })).toEqual({
      leaves: [5, 40, 88],
      lowest: 5,
    });
  });

  it('returns null for a shape mismatch', () => {
    expect(asNightleafHand(null)).toBeNull();
    expect(asNightleafHand({ leaves: ['x'], lowest: 1 })).toBeNull();
    expect(asNightleafHand({ leaves: [1] })).toBeNull();
  });
});

describe('encodeMove', () => {
  it('serializes play and hush moves', () => {
    expect(encodeMove({ kind: 'play' })).toBe('{"kind":"play"}');
    expect(encodeMove({ kind: 'hush' })).toBe('{"kind":"hush"}');
  });
});
