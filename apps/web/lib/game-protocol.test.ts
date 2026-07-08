import { describe, expect, it } from 'vitest';
import { asTriviaPrompt, asTriviaRoundReveal } from './game-protocol';

describe('asTriviaPrompt', () => {
  it('accepts a prompt whose difficulty is the tier string the engine actually sends', () => {
    // The engine puts question.difficulty (a tier: 'easy'|'medium'|'hard') on the prompt. Requiring
    // a number here silently rejected every real prompt and left the viewer stuck on "Get ready".
    const prompt = asTriviaPrompt({
      round: 1,
      category: 'Things',
      difficulty: 'easy',
      question: 'What tool applies paint?',
    });
    expect(prompt).toEqual({
      round: 1,
      category: 'Things',
      difficulty: 'easy',
      question: 'What tool applies paint?',
    });
  });

  it('rejects a prompt that is missing a field or malformed', () => {
    expect(asTriviaPrompt(null)).toBeNull();
    expect(asTriviaPrompt({ round: 1, category: 'Things', question: 'x' })).toBeNull();
    expect(
      asTriviaPrompt({ round: '1', category: 'Things', difficulty: 'easy', question: 'x' }),
    ).toBeNull();
  });

  it('rejects a numeric difficulty (guards against re-tightening to the old wrong type)', () => {
    // The original bug: the decoder demanded a number, so every real (tier-string) prompt was
    // dropped. Pin the boundary so a future change back to `number` fails here.
    expect(
      asTriviaPrompt({ round: 1, category: 'Things', difficulty: 5, question: 'x' }),
    ).toBeNull();
  });
});

describe('asTriviaRoundReveal', () => {
  it('decodes an answer-round reveal', () => {
    const reveal = asTriviaRoundReveal({
      round: 1,
      question: 'What is H2O?',
      answers: ['Water'],
      correct: ['p1'],
      wrong: ['p2'],
    });
    expect(reveal).toMatchObject({ round: 1, answers: ['Water'], correct: ['p1'], wrong: ['p2'] });
  });

  it('returns null for the dispute-reveal shape (no answers array)', () => {
    expect(asTriviaRoundReveal({ round: 1, upheld: ['p2'] })).toBeNull();
  });
});
