// CI gate: loads the public SAMPLE question bank from disk and validates its structure end-to-end.
// A failing integration test here means the sample data files or the loader/validator are broken.
// The validator checks per-item structure only (no total/per-category count, no difficulty spread) -
// the bank grows and its spread is uneven, so the synthetic tests below cover only structural rules.

import { describe, it, expect } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  loadQuestionBank,
  validateQuestionBank,
  isRecallQuestion,
  isTrueFalseQuestion,
  isMultipleChoiceCapable,
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

    // The first sample item is a recall question, so its `answers` array is present.
    const sample = questions.find(isRecallQuestion)!;
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

  it('accepts Title-Case answers (casing is not enforced; matching is case-insensitive)', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, answers: ['Carbon Dioxide', 'CO2'] } as TriviaQuestion;
    expect(() => validateQuestionBank(bank)).not.toThrow();
  });

  it('throws on a blank answer', () => {
    const bank = makeValidBank();
    bank[0] = { ...bank[0]!, answers: [''] } as TriviaQuestion;
    expect(() => validateQuestionBank(bank)).toThrow('blank answer');
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

// ---------------------------------------------------------------------------
// Multi-type shapes (spec 0074): recall + choices, and true/false
// ---------------------------------------------------------------------------

describe('validateQuestionBank - multi-type shapes (spec 0074)', () => {
  it('accepts a recall item carrying >= 3 choices (MC-eligible)', () => {
    const bank = makeValidBank();
    bank[0] = {
      ...(bank[0] as { id: string; category: string; prompt: string }),
      answers: ['Cheetah'],
      choices: ['Lion', 'Pronghorn', 'Greyhound'],
      difficulty: 2,
    } as TriviaQuestion;
    expect(() => validateQuestionBank(bank)).not.toThrow();
  });

  it('throws when choices are present but fewer than 3', () => {
    const bank = makeValidBank();
    (bank[0] as { choices?: string[] }).choices = ['Only', 'Two'];
    expect(() => validateQuestionBank(bank)).toThrow('fewer than 3');
  });

  it('throws on a blank choice', () => {
    const bank = makeValidBank();
    (bank[0] as { choices?: string[] }).choices = ['A', 'B', ''];
    expect(() => validateQuestionBank(bank)).toThrow('blank choice');
  });

  it('throws when a distractor equals an accepted answer (case-insensitively)', () => {
    // A distractor equal to the answer would duplicate an MC option and let a player score by tapping
    // the "distractor" (engineer review, PR #174).
    const bank = makeValidBank();
    const item = bank[0] as { answers: string[]; choices?: string[] };
    item.choices = [item.answers[0]!.toUpperCase(), 'Some Distractor', 'Another Distractor'];
    expect(() => validateQuestionBank(bank)).toThrow('distractor equal to an accepted answer');
  });

  it('accepts a true/false item with a boolean isTrue and no answers', () => {
    const bank = makeValidBank();
    bank[0] = {
      id: 'nature-001',
      type: 'true-false',
      category: 'Nature',
      prompt: 'Lightning is hotter than the surface of the Sun.',
      isTrue: true,
      difficulty: 6,
    };
    expect(() => validateQuestionBank(bank)).not.toThrow();
  });

  it('throws when a true/false item has a non-boolean isTrue', () => {
    const bank = makeValidBank();
    bank[0] = {
      id: 'nature-001',
      type: 'true-false',
      category: 'Nature',
      prompt: 'A statement.',
      // @ts-expect-error - deliberately wrong shape for the negative test
      isTrue: 'yes',
      difficulty: 3,
    };
    expect(() => validateQuestionBank(bank)).toThrow('isTrue');
  });
});

describe('question type guards (spec 0074)', () => {
  const recall: TriviaQuestion = {
    id: 'nature-001',
    category: 'Nature',
    prompt: 'q?',
    answers: ['A'],
    difficulty: 2,
  };
  const recallMc: TriviaQuestion = { ...recall, id: 'nature-002', choices: ['B', 'C', 'D'] };
  const trueFalse: TriviaQuestion = {
    id: 'nature-003',
    type: 'true-false',
    category: 'Nature',
    prompt: 's.',
    isTrue: false,
    difficulty: 2,
  };

  it('classifies recall (default and explicit), MC-capable, and true/false items', () => {
    expect(isRecallQuestion(recall)).toBe(true);
    expect(isRecallQuestion(recallMc)).toBe(true);
    expect(isRecallQuestion(trueFalse)).toBe(false);
    expect(isTrueFalseQuestion(trueFalse)).toBe(true);
    expect(isTrueFalseQuestion(recall)).toBe(false);
    expect(isMultipleChoiceCapable(recallMc)).toBe(true);
    expect(isMultipleChoiceCapable(recall)).toBe(false); // no choices -> open-only
    expect(isMultipleChoiceCapable(trueFalse)).toBe(false);
  });
});
