// CI gate: loads the real question bank from disk and validates it end-to-end.
// A failing test here means the data files or the validator are broken.

import { describe, it, expect } from 'vitest';
import {
  loadQuestionBank,
  validateQuestionBank,
  CATEGORIES,
  type TriviaQuestion,
} from './question-bank.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid bank of `n` questions for a single category. */
function makeQuestions(category: string, n: number): TriviaQuestion[] {
  const prefix = category.toLowerCase();
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    category,
    prompt: `Question ${i + 1} for ${category}?`,
    answers: ['answer'],
    difficulty: (i % 3 === 0
      ? 'easy'
      : i % 3 === 1
        ? 'medium'
        : 'hard') as TriviaQuestion['difficulty'],
  }));
}

/** Build a valid 1600-question bank across all 8 categories. */
function makeValidBank(): TriviaQuestion[] {
  return CATEGORIES.flatMap((cat) => makeQuestions(cat, 200));
}

// ---------------------------------------------------------------------------
// Integration tests (real data)
// ---------------------------------------------------------------------------

describe('question-bank - real data', () => {
  it('loads 1600 questions across all 8 categories', async () => {
    const questions = await loadQuestionBank();
    expect(questions).toHaveLength(1600);

    const sample = questions[0]!;
    expect(typeof sample.id).toBe('string');
    expect(typeof sample.prompt).toBe('string');
    expect(Array.isArray(sample.answers)).toBe(true);
    expect(['easy', 'medium', 'hard']).toContain(sample.difficulty);

    const byCategory = new Map<string, number>();
    for (const q of questions) {
      byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    }
    for (const category of CATEGORIES) {
      expect(byCategory.get(category), `${category} count`).toBe(200);
    }
  });

  it('passes full validator without throwing', async () => {
    const questions = await loadQuestionBank();
    expect(() => validateQuestionBank(questions)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Validator unit tests (synthetic data)
// ---------------------------------------------------------------------------

describe('validateQuestionBank - rule violations', () => {
  it('throws when total count is wrong', () => {
    const bank = makeValidBank().slice(0, 1599);
    expect(() => validateQuestionBank(bank)).toThrow('1600');
  });

  it('throws when a category has the wrong count', () => {
    const bank = makeValidBank();
    // Remove one Nature question so count becomes 199
    const without = bank.filter((q) => !(q.category === 'Nature' && q.id === 'nature-200'));
    // Add a duplicate-category question to keep total at 1600
    without.push({
      id: 'history-201',
      category: 'History',
      prompt: 'Extra?',
      answers: ['x'],
      difficulty: 'easy',
    });
    expect(() => validateQuestionBank(without)).toThrow('Nature');
  });

  it('throws on duplicate id', () => {
    const bank = makeValidBank();
    bank[1] = { ...bank[0]! };
    expect(() => validateQuestionBank(bank)).toThrow('duplicate id');
  });

  it('throws when an answer is not lowercase', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, answers: ['Valid'] };
    expect(() => validateQuestionBank(bank)).toThrow('lowercase');
  });

  it('throws on invalid difficulty value', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, difficulty: 'extreme' as TriviaQuestion['difficulty'] };
    expect(() => validateQuestionBank(bank)).toThrow('difficulty');
  });

  it('throws when a category has too few questions in a difficulty tier', () => {
    const bank = makeValidBank();
    // Replace all Nature hard questions with easy, leaving 0 hard in Nature
    for (const q of bank) {
      if (q.category === 'Nature' && q.difficulty === 'hard') {
        (q as { difficulty: string }).difficulty = 'easy';
      }
    }
    expect(() => validateQuestionBank(bank)).toThrow('Nature');
  });

  it('throws on duplicate prompt within a category', () => {
    const bank = makeValidBank();
    bank[1] = { ...bank[1]!, id: 'nature-002', prompt: bank[0]!.prompt };
    expect(() => validateQuestionBank(bank)).toThrow('duplicate prompt');
  });
});
