// CI gate: loads the public SAMPLE question bank from disk and validates its structure end-to-end.
// A failing integration test here means the sample data files or the loader/validator are broken.
// The validator checks per-item structure only (no total/per-category count, no difficulty spread) -
// the bank grows and its spread is uneven, so the synthetic tests below cover only structural rules.

import { describe, it, expect } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  loadQuestionBank,
  validateQuestionBank,
  CATEGORIES,
  type TriviaQuestion,
} from './question-bank.js';

// A real filesystem loader rooted at this package - proves the injected loader resolves the
// package's own data/trivia from the package root under vitest (guards the path resolution).
const assets = createFsAssetLoaderFactory().forModule(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid bank of `n` questions for a single category (distinct ids/prompts). */
function makeQuestions(category: string, n: number): TriviaQuestion[] {
  const prefix = category.toLowerCase();
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    category,
    prompt: `Question ${i + 1} for ${category}?`,
    answers: ['answer'],
    difficulty: (i % 10) + 1,
  }));
}

/** A small valid bank across all 8 categories - structural checks pass regardless of size. */
function makeValidBank(): TriviaQuestion[] {
  return CATEGORIES.flatMap((cat) => makeQuestions(cat, 5));
}

// ---------------------------------------------------------------------------
// Integration test (real sample data)
// ---------------------------------------------------------------------------

describe('question-bank - sample data', () => {
  it('loads a non-empty sample and passes the structural validator', async () => {
    const questions = await loadQuestionBank(assets);
    expect(questions.length).toBeGreaterThan(0);

    const sample = questions[0]!;
    expect(typeof sample.id).toBe('string');
    expect(typeof sample.prompt).toBe('string');
    expect(Array.isArray(sample.answers)).toBe(true);
    expect(Number.isInteger(sample.difficulty)).toBe(true);
    expect(sample.difficulty).toBeGreaterThanOrEqual(1);
    expect(sample.difficulty).toBeLessThanOrEqual(10);

    // The sample must carry all 8 categories (loadQuestionBank flattens 8 files); a truncated or
    // renamed sample file would otherwise shrink the bank silently while still passing `length > 0`.
    const present = new Set(questions.map((q) => q.category));
    for (const category of CATEGORIES) {
      expect(present.has(category), `${category} present`).toBe(true);
    }

    expect(() => validateQuestionBank(questions)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Validator unit tests (synthetic data) - structural rules only
// ---------------------------------------------------------------------------

describe('validateQuestionBank - structural violations', () => {
  it('accepts a small valid bank of any size', () => {
    expect(() => validateQuestionBank(makeValidBank())).not.toThrow();
  });

  it('throws on duplicate id', () => {
    const bank = makeValidBank();
    bank[1] = { ...bank[0]! };
    expect(() => validateQuestionBank(bank)).toThrow('duplicate id');
  });

  it('throws on an invalid id format', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, id: 'nature-1' }; // two digits short
    expect(() => validateQuestionBank(bank)).toThrow('invalid id format');
  });

  it('throws when an answer is not lowercase', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, answers: ['Valid'] };
    expect(() => validateQuestionBank(bank)).toThrow('lowercase');
  });

  it('throws on an out-of-range difficulty value', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, difficulty: 11 };
    expect(() => validateQuestionBank(bank)).toThrow('difficulty');
  });

  it('throws on a non-integer difficulty value', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, difficulty: 4.5 };
    expect(() => validateQuestionBank(bank)).toThrow('difficulty');
  });

  it('throws on duplicate prompt within a category (case- and space-insensitive)', () => {
    const bank = makeValidBank();
    // A case/space variant of the first prompt exercises the validator's trim().toLowerCase()
    // normalization, so a dropped .toLowerCase() would fail this test.
    bank[1] = { ...bank[1]!, id: 'nature-002', prompt: `  ${bank[0]!.prompt.toUpperCase()}  ` };
    expect(() => validateQuestionBank(bank)).toThrow('duplicate prompt');
  });
});
