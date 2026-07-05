// CI gate: loads the real question bank from disk and validates it end-to-end.
// A failing test here means the data files or the validator are broken.

import { describe, it, expect } from 'vitest';
import { loadQuestionBank, validateQuestionBank, CATEGORIES } from './question-bank.js';

describe('question-bank', () => {
  it('loads 1600 questions across all 8 categories', async () => {
    const questions = await loadQuestionBank();
    expect(questions).toHaveLength(1600);

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
