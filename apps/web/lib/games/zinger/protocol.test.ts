import { describe, expect, it } from 'vitest';
import {
  asZingerFaceOff,
  asZingerPrompt,
  asZingerResult,
  pickFaceOff,
  pickResult,
} from './protocol';

const faceOffReveal = {
  round: 1,
  setup: 'A bad name for a boat is ___.',
  options: [
    { id: '0', text: 'The Titanic 2' },
    { id: '1', text: 'Wet Bandit' },
  ],
  authorIds: ['p1', 'p2'],
};

const resultReveal = {
  round: 1,
  setup: 'A bad name for a boat is ___.',
  options: [
    { id: '0', text: 'The Titanic 2', author: 'p1', votes: 2, winner: true },
    { id: '1', text: 'Wet Bandit', author: 'p2', votes: 1, winner: false },
  ],
  winner: '0',
  cleanSweep: false,
};

describe('zinger decoders', () => {
  it('decodes the prompt', () => {
    expect(asZingerPrompt({ round: 2, setup: 'x' })).toEqual({ round: 2, setup: 'x' });
    // A reveal (has options) is not a prompt.
    expect(asZingerPrompt(faceOffReveal)).toBeNull();
    expect(asZingerPrompt(null)).toBeNull();
  });

  it('decodes the face-off (with contestant author ids) but not the result', () => {
    expect(asZingerFaceOff(faceOffReveal)).toEqual(faceOffReveal);
    // A result carries a `winner`, so it is not a face-off.
    expect(asZingerFaceOff(resultReveal)).toBeNull();
    expect(asZingerFaceOff({ round: 1, setup: 'x' })).toBeNull();
  });

  it('tolerates a face-off missing authorIds (decodes to an empty list)', () => {
    const noAuthors = { round: 1, setup: faceOffReveal.setup, options: faceOffReveal.options };
    expect(asZingerFaceOff(noAuthors)?.authorIds).toEqual([]);
  });

  it('decodes the result but not the face-off', () => {
    expect(asZingerResult(resultReveal)).toEqual(resultReveal);
    expect(asZingerResult(faceOffReveal)).toBeNull();
  });

  it('decodes a tie result (winner null)', () => {
    const tie = { ...resultReveal, winner: null };
    expect(asZingerResult(tie)?.winner).toBeNull();
  });

  it('picks the latest face-off and result from a reveal list', () => {
    const reveals = [faceOffReveal, resultReveal];
    expect(pickFaceOff(reveals)).toEqual(faceOffReveal);
    expect(pickResult(reveals)).toEqual(resultReveal);
  });
});
