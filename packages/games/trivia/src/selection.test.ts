import { describe, expect, it } from 'vitest';
import type { TriviaQuestion } from './question-bank';
import { indexQuestions, pickQuestion, poolFor, RANDOM_CATEGORY } from './selection';

function q(id: string, category: string, difficulty: number): TriviaQuestion {
  return { id, category, prompt: `${id}?`, answers: [id], difficulty };
}

const bank: TriviaQuestion[] = [
  q('nature-1', 'Nature', 2),
  q('nature-2', 'Nature', 5),
  q('nature-3', 'Nature', 9),
  q('food-1', 'Food', 2),
  q('food-2', 'Food', 9),
];

describe('pickQuestion', () => {
  const index = indexQuestions(bank);
  const rng = () => 0; // always take the first available candidate

  it('draws an unused question whose rating is inside the range', () => {
    const picked = pickQuestion(index, ['Nature'], 4, 6, new Set(), rng);
    expect(picked?.id).toBe('nature-2'); // the only Nature question rated 4-6
  });

  it('widens to the nearest rating when the range holds nothing', () => {
    // No Food question rates 4-6; nearest is 2 (distance 2) vs 9 (distance 3), so the 2 wins.
    const picked = pickQuestion(index, ['Food'], 4, 6, new Set(), rng);
    expect(picked?.id).toBe('food-1');
  });

  it('never returns an already-used question', () => {
    const used = new Set(['nature-2']);
    // The in-range 5 is used, so it widens: 2 (distance 2) beats 9 (distance 3).
    const picked = pickQuestion(index, ['Nature'], 4, 6, used, rng);
    expect(picked?.id).toBe('nature-1');
  });

  it('prefers any in-range question over a nearer out-of-range one', () => {
    // Range 1-6 covers ratings 2 and 5; both are distance 0, so the 9 is never considered.
    const used = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const picked = pickQuestion(index, ['Nature'], 1, 6, used, () => 0);
      used.add(picked!.id);
      seen.add(picked!.id);
    }
    expect(seen).toEqual(new Set(['nature-1', 'nature-2']));
  });

  it('breaks an equidistant widening tie toward the easier (lower) rating', () => {
    // Ratings 3 and 7 are both distance 2 from the single-value range [5, 5]; the easier 3 wins.
    // The harder question is listed first so rng=0 would pick it absent the tie-break - this test
    // fails if the easier-side bias is removed.
    const tieIndex = indexQuestions([q('nature-hi', 'Nature', 7), q('nature-lo', 'Nature', 3)]);
    const picked = pickQuestion(tieIndex, ['Nature'], 5, 5, new Set(), () => 0);
    expect(picked?.id).toBe('nature-lo');
  });

  it('returns null only when the whole pool is exhausted', () => {
    const used = new Set(bank.filter((x) => x.category === 'Food').map((x) => x.id));
    expect(pickQuestion(index, ['Food'], 4, 6, used, rng)).toBeNull();
  });

  it('draws across all categories for an empty (Random) selection', () => {
    const seen = new Set<string>();
    const used = new Set<string>();
    for (let i = 0; i < bank.length; i += 1) {
      const picked = pickQuestion(index, [], 1, 10, used, () => 0);
      expect(picked).not.toBeNull();
      expect(used.has(picked!.id)).toBe(false);
      used.add(picked!.id);
      seen.add(picked!.category);
    }
    expect(seen).toEqual(new Set(['Nature', 'Food']));
    expect(pickQuestion(index, [], 1, 10, used, () => 0)).toBeNull();
  });

  it('draws only from a multi-category subset, unioning their pools', () => {
    const three = indexQuestions([...bank, q('science-1', 'Science', 5)]);
    const seen = new Set<string>();
    const used = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const picked = pickQuestion(three, ['Nature', 'Science'], 1, 10, used, () => 0);
      used.add(picked!.id);
      seen.add(picked!.category);
    }
    // Never a Food question, even though the bank has some.
    expect(seen.has('Food')).toBe(false);
  });
});

describe('poolFor', () => {
  const index = indexQuestions(bank);

  it('returns the cross-category union for an empty (Random) selection', () => {
    expect(poolFor(index, []).length).toBe(bank.length);
    // The Random bucket the index builds is that same union.
    expect(index.byCategory.get(RANDOM_CATEGORY)?.length).toBe(bank.length);
  });

  it('unions the named categories, and treats an unknown one as contributing nothing', () => {
    expect(poolFor(index, ['Nature']).length).toBe(3);
    expect(poolFor(index, ['Nature', 'Food']).length).toBe(5);
    expect(poolFor(index, ['Nature', 'Nope']).length).toBe(3);
  });
});
