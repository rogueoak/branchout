import { describe, expect, it } from 'vitest';
import {
  asSketchyOptions,
  asSketchyPrompt,
  asSketchyResult,
  asSketchySeedSecret,
  pickGallery,
  pickOptions,
  pickResult,
} from './protocol';

const drawPrompt = { round: 1, stage: 'draw' };
const sketchPrompt = {
  round: 2,
  stage: 'sketch',
  featured: 'p1',
  sketch: { strokes: [{ color: '#0d0a15', points: [0, 0, 100, 100] }] },
};
const gallery = {
  round: 1,
  stage: 'draw',
  gallery: [{ player: 'p1', sketch: { strokes: [{ color: '#0d0a15', points: [1, 2, 3, 4] }] } }],
};
const optionsReveal = {
  round: 2,
  stage: 'sketch',
  featured: 'p1',
  sketch: { strokes: [] },
  options: [
    { id: '0', text: 'a cat' },
    { id: '1', text: 'a dog' },
  ],
};
const resultReveal = {
  round: 2,
  stage: 'result',
  featured: 'p1',
  sketch: { strokes: [] },
  trueSeed: 'a cat',
  options: [
    { id: '0', text: 'a cat', kind: 'truth', pickedBy: ['p2'] },
    { id: '1', text: 'a dog', kind: 'decoy', author: 'p3', pickedBy: [] },
  ],
  correctGuessers: ['p2'],
};

describe('asSketchySeedSecret', () => {
  it('decodes a private seed payload and rejects the wrong shape', () => {
    expect(asSketchySeedSecret({ seed: 'a cat' })).toEqual({ seed: 'a cat' });
    expect(asSketchySeedSecret({ nope: 1 })).toBeNull();
    expect(asSketchySeedSecret(null)).toBeNull();
  });
});

describe('asSketchyPrompt', () => {
  it('decodes a draw prompt and a sketch prompt', () => {
    expect(asSketchyPrompt(drawPrompt)).toEqual({ round: 1, stage: 'draw' });
    const decoded = asSketchyPrompt(sketchPrompt);
    expect(decoded?.stage).toBe('sketch');
    expect(decoded && decoded.stage === 'sketch' ? decoded.featured : null).toBe('p1');
    expect(decoded && decoded.stage === 'sketch' ? decoded.sketch?.strokes.length : 0).toBe(1);
  });

  it('returns null for an unknown stage', () => {
    expect(asSketchyPrompt({ round: 1, stage: 'weird' })).toBeNull();
  });
});

describe('options vs result disambiguation', () => {
  it('options decode only the pre-guess reveal (no trueSeed)', () => {
    expect(asSketchyOptions(optionsReveal)?.options).toHaveLength(2);
    // The final result carries trueSeed, so it is NOT decoded as options.
    expect(asSketchyOptions(resultReveal)).toBeNull();
  });

  it('result decodes only the final reveal', () => {
    expect(asSketchyResult(resultReveal)?.trueSeed).toBe('a cat');
    expect(asSketchyResult(optionsReveal)).toBeNull();
  });
});

describe('pickers scan the reveal list', () => {
  it('find the latest options, result, and gallery', () => {
    expect(pickOptions([drawPrompt, optionsReveal])?.round).toBe(2);
    expect(pickResult([optionsReveal, resultReveal])?.trueSeed).toBe('a cat');
    expect(pickGallery([gallery])?.gallery).toHaveLength(1);
  });
});
