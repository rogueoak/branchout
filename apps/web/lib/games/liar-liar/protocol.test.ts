import { describe, expect, it } from 'vitest';
import {
  asLiarLiarOptions,
  asLiarLiarPrompt,
  asLiarLiarResult,
  pickOptions,
  pickResult,
} from './protocol';

const optionsReveal = {
  round: 1,
  clue: 'A museum is dedicated to ___.',
  options: [
    { id: '0', text: 'penises' },
    { id: '1', text: 'buttons' },
    { id: '2', text: 'lint' },
  ],
};

const resultReveal = {
  round: 1,
  clue: 'A museum is dedicated to ___.',
  truth: 'penises',
  options: [
    { id: '0', text: 'penises', kind: 'truth', pickedBy: ['p2'] },
    { id: '1', text: 'buttons', kind: 'fake', author: 'p1', pickedBy: ['p3'] },
    { id: '2', text: 'lint', kind: 'fake', author: 'p3', pickedBy: [] },
  ],
  correctGuessers: ['p2'],
};

describe('liar-liar decoders', () => {
  it('decodes the prompt', () => {
    expect(asLiarLiarPrompt({ round: 2, clue: 'x', category: 'food' })).toEqual({
      round: 2,
      clue: 'x',
      category: 'food',
    });
    expect(asLiarLiarPrompt({ round: 2, clue: 'x' })).toBeNull();
    expect(asLiarLiarPrompt(null)).toBeNull();
  });

  it('decodes the guess options and rejects the final result (which has a truth)', () => {
    expect(asLiarLiarOptions(optionsReveal)?.options).toHaveLength(3);
    // The final result must NOT decode as the options reveal (it carries `truth`).
    expect(asLiarLiarOptions(resultReveal)).toBeNull();
    expect(asLiarLiarOptions({ round: 1, clue: 'x', options: [{ id: 1 }] })).toBeNull();
  });

  it('decodes the final result with attribution', () => {
    const decoded = asLiarLiarResult(resultReveal);
    expect(decoded?.truth).toBe('penises');
    expect(decoded?.options[1]?.author).toBe('p1');
    expect(decoded?.correctGuessers).toEqual(['p2']);
    expect(asLiarLiarResult(optionsReveal)).toBeNull(); // no truth
  });

  it('picks the options and the result out of the reveals list', () => {
    const reveals = [optionsReveal, resultReveal];
    expect(pickOptions(reveals)?.options).toHaveLength(3);
    expect(pickResult(reveals)?.truth).toBe('penises');
    // During guessing only the options reveal exists.
    expect(pickResult([optionsReveal])).toBeNull();
    expect(pickOptions([optionsReveal])?.options).toHaveLength(3);
  });
});
