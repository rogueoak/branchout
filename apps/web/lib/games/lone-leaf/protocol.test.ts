import { describe, expect, it } from 'vitest';
import {
  asLoneLeafPrompt,
  asLoneLeafResult,
  asLoneLeafSecret,
  asLoneLeafSurvivors,
  pickResult,
  pickSurvivors,
} from './protocol';

const survivorsReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  survivors: ['flow', 'blue'],
  leaves: [
    { player: 'p2', word: 'flow', survived: true },
    { player: 'p3', word: 'blue', survived: true },
    { player: 'p4', word: 'water', survived: false },
    { player: 'p5', word: 'water', survived: false },
  ],
};

const resultReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  seed: 'river',
  guess: 'river',
  correct: true,
  survivors: ['flow', 'blue'],
  leaves: survivorsReveal.leaves,
};

describe('lone-leaf decoders', () => {
  it('decodes the prompt (round, theme, seeker) with no seed', () => {
    expect(asLoneLeafPrompt({ round: 2, category: 'food', seeker: 'p3' })).toEqual({
      round: 2,
      category: 'food',
      seeker: 'p3',
    });
    expect(asLoneLeafPrompt({ round: 2, category: 'food' })).toBeNull();
    expect(asLoneLeafPrompt(null)).toBeNull();
  });

  it('decodes the private seed payload', () => {
    expect(asLoneLeafSecret({ round: 1, seed: 'river', category: 'nature' })).toEqual({
      round: 1,
      seed: 'river',
      category: 'nature',
    });
    expect(asLoneLeafSecret({ round: 1, category: 'nature' })).toBeNull();
  });

  it('decodes the survivors reveal and rejects the final result (which has a seed)', () => {
    expect(asLoneLeafSurvivors(survivorsReveal)?.survivors).toEqual(['flow', 'blue']);
    // The final result must NOT decode as the survivors reveal (it carries `seed`).
    expect(asLoneLeafSurvivors(resultReveal)).toBeNull();
  });

  it('decodes the final result with the seed and the outcome', () => {
    const decoded = asLoneLeafResult(resultReveal);
    expect(decoded?.seed).toBe('river');
    expect(decoded?.correct).toBe(true);
    expect(asLoneLeafResult(survivorsReveal)).toBeNull(); // no seed
  });

  it('picks the survivors and the result out of the reveals list', () => {
    const reveals = [survivorsReveal, resultReveal];
    expect(pickSurvivors(reveals)?.survivors).toEqual(['flow', 'blue']);
    expect(pickResult(reveals)?.seed).toBe('river');
    // During guessing only the survivors reveal exists.
    expect(pickResult([survivorsReveal])).toBeNull();
    expect(pickSurvivors([survivorsReveal])?.survivors).toEqual(['flow', 'blue']);
  });
});
