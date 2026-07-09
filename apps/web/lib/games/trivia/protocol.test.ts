import { describe, expect, it } from 'vitest';
import { asTriviaPrompt, asTriviaRoundReveal } from './protocol';

describe('asTriviaPrompt', () => {
  it('accepts a prompt whose difficulty is the numeric rating the engine sends (spec 0016)', () => {
    // The engine puts question.difficulty (an integer 1-10) on the prompt after the tier -> rating
    // migration. The decoder accepts a number here.
    const prompt = asTriviaPrompt({
      round: 1,
      category: 'Things',
      difficulty: 7,
      question: 'What tool applies paint?',
    });
    expect(prompt).toEqual({
      round: 1,
      category: 'Things',
      difficulty: 7,
      question: 'What tool applies paint?',
    });
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
  it('decodes an answer-round reveal, including per-player submissions', () => {
    const reveal = asTriviaRoundReveal({
      round: 1,
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
      answers: ['Water'],
      correct: ['p1'],
      wrong: ['p2'],
      submissions: [
        { player: 'p1', answer: 'water', correct: true },
        { player: 'p2', answer: 'juice', correct: false },
      ],
    });
  });

  it('defaults submissions to [] when a pre-0017 payload omits them', () => {
    const reveal = asTriviaRoundReveal({
      round: 1,
      question: 'x',
      answers: ['a'],
      correct: [],
      wrong: [],
    });
    expect(reveal?.submissions).toEqual([]);
  });

  it('returns null for the dispute-reveal shape (no answers array)', () => {
    expect(asTriviaRoundReveal({ round: 1, upheld: ['p2'] })).toBeNull();
  });
});
