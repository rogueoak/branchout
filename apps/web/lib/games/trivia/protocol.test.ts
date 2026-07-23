import { describe, expect, it } from 'vitest';
import { asTriviaPrompt, asTriviaRoundReveal } from './protocol';

describe('asTriviaPrompt', () => {
  it('accepts a prompt whose difficulty is the numeric rating the engine sends (spec 0016)', () => {
    // The engine puts question.difficulty (an integer 1-10) on the prompt after the tier -> rating
    // migration. The decoder accepts a number here.
    const prompt = asTriviaPrompt({
      round: 1,
      type: 'open',
      category: 'Things',
      difficulty: 7,
      question: 'What tool applies paint?',
    });
    expect(prompt).toEqual({
      round: 1,
      type: 'open',
      category: 'Things',
      difficulty: 7,
      question: 'What tool applies paint?',
    });
  });

  it('decodes a multiple-choice prompt with its four shuffled options (spec 0074)', () => {
    const prompt = asTriviaPrompt({
      round: 2,
      type: 'multiple-choice',
      category: 'Animals',
      difficulty: 3,
      question: 'What is the fastest land animal?',
      choices: ['Lion', 'Cheetah', 'Pronghorn', 'Greyhound'],
    });
    expect(prompt).toEqual({
      round: 2,
      type: 'multiple-choice',
      category: 'Animals',
      difficulty: 3,
      question: 'What is the fastest land animal?',
      choices: ['Lion', 'Cheetah', 'Pronghorn', 'Greyhound'],
    });
  });

  it('decodes a true-false prompt as a statement with no choices (spec 0074)', () => {
    const prompt = asTriviaPrompt({
      round: 3,
      type: 'true-false',
      category: 'Animals',
      difficulty: 4,
      question: "A shrimp's heart is located in its head.",
    });
    expect(prompt).toMatchObject({ type: 'true-false' });
    expect(prompt?.choices).toBeUndefined();
  });

  it('defaults a legacy prompt with no type to open, and ignores stray choices off MC', () => {
    // A pre-0074 peer omits `type`; it must render as the free-text open round it always was.
    const prompt = asTriviaPrompt({
      round: 1,
      category: 'Things',
      difficulty: 7,
      question: 'x',
      choices: ['a', 'b'],
    });
    expect(prompt?.type).toBe('open');
    // Choices only ride a multiple-choice prompt; on an open round they are dropped.
    expect(prompt?.choices).toBeUndefined();
  });

  it('rejects a prompt that is missing a field or malformed', () => {
    expect(asTriviaPrompt(null)).toBeNull();
    expect(asTriviaPrompt({ round: 1, category: 'Things', question: 'x' })).toBeNull();
    expect(
      asTriviaPrompt({ round: '1', category: 'Things', difficulty: 7, question: 'x' }),
    ).toBeNull();
  });

  it('rejects a tier-string difficulty (the pre-0016 shape is no longer sent)', () => {
    // Guards the wire against a peer that still emits the old easy/medium/hard tier string.
    expect(
      asTriviaPrompt({ round: 1, category: 'Things', difficulty: 'easy', question: 'x' }),
    ).toBeNull();
  });
});

describe('asTriviaRoundReveal', () => {
  it('decodes an answer-round reveal, including its type and per-player submissions', () => {
    const reveal = asTriviaRoundReveal({
      round: 1,
      type: 'open',
      question: 'What is H2O?',
      answers: ['Water'],
      correct: ['p1'],
      wrong: ['p2'],
      submissions: [
        { player: 'p1', answer: 'water', correct: true },
        { player: 'p2', answer: 'juice', correct: false },
      ],
    });
    expect(reveal).toMatchObject({
      round: 1,
      type: 'open',
      answers: ['Water'],
      correct: ['p1'],
      wrong: ['p2'],
      submissions: [
        { player: 'p1', answer: 'water', correct: true },
        { player: 'p2', answer: 'juice', correct: false },
      ],
    });
  });

  it('decodes a multiple-choice reveal type', () => {
    const reveal = asTriviaRoundReveal({
      round: 2,
      type: 'multiple-choice',
      question: 'Fastest land animal?',
      answers: ['Cheetah'],
      correct: ['p1'],
      wrong: [],
    });
    expect(reveal?.type).toBe('multiple-choice');
  });

  it('defaults type to open and submissions to [] when a legacy payload omits them', () => {
    const reveal = asTriviaRoundReveal({
      round: 1,
      question: 'x',
      answers: ['a'],
      correct: [],
      wrong: [],
    });
    expect(reveal?.type).toBe('open');
    expect(reveal?.submissions).toEqual([]);
  });

  it('returns null for the dispute-reveal shape (no answers array)', () => {
    expect(asTriviaRoundReveal({ round: 1, upheld: ['p2'] })).toBeNull();
  });
});
