import { describe, expect, it } from 'vitest';
import type { TriviaQuestion } from '../../question-bank';
import { indexQuestions, pickQuestion, RANDOM_CATEGORY } from './selection';

function q(id: string, category: string, difficulty: TriviaQuestion['difficulty']): TriviaQuestion {
  return { id, category, prompt: `${id}?`, answers: [id], difficulty };
}

const bank: TriviaQuestion[] = [
  q('nature-1', 'Nature', 'easy'),
  q('nature-2', 'Nature', 'medium'),
  q('nature-3', 'Nature', 'hard'),
  q('food-1', 'Food', 'easy'),
  q('food-2', 'Food', 'hard'),
];

describe('pickQuestion', () => {
  const index = indexQuestions(bank);
  const rng = () => 0; // always take the first available candidate

  it('draws an unused question of the requested tier and category', () => {
    const picked = pickQuestion(index, 'Nature', 'medium', new Set(), rng);
    expect(picked?.id).toBe('nature-2');
  });

  it('falls back to the nearest tier when the requested tier is exhausted', () => {
    // No "medium" Food question exists, so it should fall to easy (nearest, tie broken easier).
    const picked = pickQuestion(index, 'Food', 'medium', new Set(), rng);
    expect(picked?.id).toBe('food-1');
  });

  it('never returns an already-used question', () => {
    const used = new Set(['nature-1']);
    const picked = pickQuestion(index, 'Nature', 'easy', used, rng);
    // easy is used, so nearest-tier fallback lands on medium (nature-2).
    expect(picked?.id).toBe('nature-2');
  });

  it('returns null only when the whole category is exhausted', () => {
    const used = new Set(bank.filter((x) => x.category === 'Food').map((x) => x.id));
    expect(pickQuestion(index, 'Food', 'easy', used, rng)).toBeNull();
  });

  it('draws across all categories for Random', () => {
    const seen = new Set<string>();
    const used = new Set<string>();
    // Drain the whole bank through the Random pool; it must span both categories with no repeat.
    for (let i = 0; i < bank.length; i += 1) {
      const picked = pickQuestion(index, RANDOM_CATEGORY, 'easy', used, () => 0);
      expect(picked).not.toBeNull();
      expect(used.has(picked!.id)).toBe(false);
      used.add(picked!.id);
      seen.add(picked!.category);
    }
    expect(seen).toEqual(new Set(['Nature', 'Food']));
    expect(pickQuestion(index, RANDOM_CATEGORY, 'easy', used, () => 0)).toBeNull();
  });

  it('indexes the Random pool as the union of all category questions', () => {
    const randomTiers = indexQuestions(bank).byCategoryTier.get(RANDOM_CATEGORY);
    const total = [...(randomTiers?.values() ?? [])].reduce((n, pool) => n + pool.length, 0);
    expect(total).toBe(bank.length);
  });
});
