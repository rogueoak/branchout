import { describe, expect, it } from 'vitest';
import { buildRoundPlan, shuffleInPlace, type RoundType, type Composition } from './plan';

/** Deterministic PRNG so a plan (and its shuffle) replays identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 0-indexed positions that hold an 'open' round. */
function openPositions(plan: RoundType[]): number[] {
  return plan.flatMap((t, i) => (t === 'open' ? [i] : []));
}

function counts(plan: RoundType[]): Composition {
  return {
    multipleChoice: plan.filter((t) => t === 'multiple-choice').length,
    trueFalse: plan.filter((t) => t === 'true-false').length,
    open: plan.filter((t) => t === 'open').length,
  };
}

const PRESETS: { name: string; composition: Composition; openAt: number[] }[] = [
  // Open placement is ceil(i * N / K) (1-indexed) -> 0-indexed positions below; last is always open.
  { name: 'fast', composition: { multipleChoice: 3, trueFalse: 2, open: 1 }, openAt: [5] },
  { name: 'standard', composition: { multipleChoice: 6, trueFalse: 4, open: 2 }, openAt: [5, 11] },
  {
    name: 'long',
    composition: { multipleChoice: 12, trueFalse: 8, open: 4 },
    openAt: [5, 11, 17, 23],
  },
  {
    name: 'marathon',
    composition: { multipleChoice: 24, trueFalse: 16, open: 8 },
    openAt: [5, 11, 17, 23, 29, 35, 41, 47],
  },
];

describe('buildRoundPlan', () => {
  for (const preset of PRESETS) {
    it(`places opens and fills the ${preset.name} composition exactly`, () => {
      const plan = buildRoundPlan(preset.composition, mulberry32(1));
      const total =
        preset.composition.multipleChoice + preset.composition.trueFalse + preset.composition.open;
      expect(plan).toHaveLength(total);
      expect(counts(plan)).toEqual(preset.composition);
      // Opens land at the evenly spaced positions, and the last question is always open.
      expect(openPositions(plan)).toEqual(preset.openAt);
      expect(plan[plan.length - 1]).toBe('open');
    });
  }

  it('handles a custom composition, always ending on an open when opens > 0', () => {
    const plan = buildRoundPlan({ multipleChoice: 4, trueFalse: 3, open: 2 }, mulberry32(9));
    expect(plan).toHaveLength(9);
    expect(counts(plan)).toEqual({ multipleChoice: 4, trueFalse: 3, open: 2 });
    // N=9, K=2: opens at ceil(9/2)=5 and ceil(18/2)=9 -> 0-indexed 4 and 8.
    expect(openPositions(plan)).toEqual([4, 8]);
    expect(plan[plan.length - 1]).toBe('open');
  });

  it('places no opens when open is 0 (all slots shuffled MC/TF)', () => {
    const plan = buildRoundPlan({ multipleChoice: 3, trueFalse: 2, open: 0 }, mulberry32(4));
    expect(plan).toHaveLength(5);
    expect(counts(plan)).toEqual({ multipleChoice: 3, trueFalse: 2, open: 0 });
    expect(openPositions(plan)).toEqual([]);
  });

  it('handles an all-open composition (every slot open)', () => {
    const plan = buildRoundPlan({ multipleChoice: 0, trueFalse: 0, open: 3 }, mulberry32(2));
    expect(plan).toEqual(['open', 'open', 'open']);
  });

  it('is deterministic under a seeded rng and varies the fill across seeds', () => {
    const composition: Composition = { multipleChoice: 6, trueFalse: 4, open: 2 };
    expect(buildRoundPlan(composition, mulberry32(7))).toEqual(
      buildRoundPlan(composition, mulberry32(7)),
    );
    // Different seeds produce (at least sometimes) a different fill order - not a fixed sequence.
    const a = buildRoundPlan(composition, mulberry32(1));
    const b = buildRoundPlan(composition, mulberry32(999));
    expect(a).not.toEqual(b);
  });
});

describe('shuffleInPlace', () => {
  it('is a permutation (keeps every element) and is deterministic under a seed', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffleInPlace([...source], mulberry32(3));
    const b = shuffleInPlace([...source], mulberry32(3));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(source);
  });
});
