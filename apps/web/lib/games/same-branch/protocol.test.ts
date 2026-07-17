import { describe, expect, it } from 'vitest';
import { asSameBranchPrompt, asSameBranchReveal, asSameBranchSecret, pickReveal } from './protocol';

describe('asSameBranchPrompt', () => {
  it('decodes a valid prompt and never carries a bud', () => {
    const prompt = asSameBranchPrompt({
      round: 1,
      category: 'senses',
      left: 'cold',
      right: 'hot',
      reader: 'p1',
    });
    expect(prompt).toEqual({
      round: 1,
      category: 'senses',
      left: 'cold',
      right: 'hot',
      reader: 'p1',
    });
    expect(prompt && 'bud' in prompt).toBe(false);
  });

  it('rejects a malformed prompt', () => {
    expect(asSameBranchPrompt(null)).toBeNull();
    expect(asSameBranchPrompt({ round: 1, left: 'a' })).toBeNull();
  });
});

describe('asSameBranchSecret', () => {
  it('decodes the Reader private payload with the bud', () => {
    expect(asSameBranchSecret({ round: 2, bud: 63, left: 'quiet', right: 'loud' })).toEqual({
      round: 2,
      bud: 63,
      left: 'quiet',
      right: 'loud',
    });
  });

  it('rejects a payload with no numeric bud', () => {
    expect(asSameBranchSecret({ round: 2, bud: 'x', left: 'a', right: 'b' })).toBeNull();
    expect(asSameBranchSecret(undefined)).toBeNull();
  });
});

describe('asSameBranchReveal / pickReveal', () => {
  const reveal = {
    round: 1,
    category: 'senses',
    left: 'cold',
    right: 'hot',
    reader: 'p1',
    hunch: 'a warm bath',
    bud: 55,
    mode: 'free',
    guesses: [
      { player: 'p2', position: 55, points: 4, band: 'bullseye' },
      { player: 'p3', position: 10, points: 0, band: 'miss' },
    ],
  };

  it('decodes a full reveal', () => {
    expect(asSameBranchReveal(reveal)).toEqual(reveal);
  });

  it('rejects a reveal with a malformed guess', () => {
    expect(
      asSameBranchReveal({ ...reveal, guesses: [{ player: 'p2', position: 'x' }] }),
    ).toBeNull();
  });

  it('picks the latest reveal from the stream, skipping unrelated shapes', () => {
    expect(pickReveal([{ nope: true }, reveal])).toEqual(reveal);
    expect(pickReveal([{ nope: true }])).toBeNull();
  });
});
