import { describe, expect, it } from 'vitest';
import { ADJECTIVES, NOUNS, generateRandomName } from './random-name';

/** An rng that replays a fixed sequence of floats, so a generated name is deterministic. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe('generateRandomName', () => {
  it('is deterministic under an injected rng: adjective then noun', () => {
    // First rng() picks the adjective, second picks the noun.
    expect(generateRandomName(seq(0, 0))).toBe('Prickly Ostrich');
  });

  it('maps low vs high rng to genuinely different list entries', () => {
    // Assert real distinctness against hand-picked expected values (NOT recomputed with the
    // implementation's own index formula, which would make this test vacuously pass).
    // rng 0 -> first entry of each list; rng ~1 -> last entry of each list.
    expect(generateRandomName(seq(0, 0))).toBe('Prickly Ostrich');
    expect(generateRandomName(seq(0.999, 0.999))).toBe('Zippy Poppy');
    // A mid-list draw is different again, so advancing the rng really moves through the lists.
    expect(generateRandomName(seq(0.5, 0.5))).toBe('Dewy Clover');
  });

  it('has an "Adjective Noun" shape (two title-cased ASCII words)', () => {
    const name = generateRandomName(seq(0.3, 0.7));
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('stays ASCII and within the 40-char display-name limit for every pairing', () => {
    for (const rngAdj of [0, 0.5, 0.999]) {
      for (const rngNoun of [0, 0.5, 0.999]) {
        const name = generateRandomName(seq(rngAdj, rngNoun));
        expect(name).toMatch(/^[\x20-\x7e]+$/);
        expect(name.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it('never exceeds 40 chars for the longest possible adjective+noun pair', () => {
    const longestAdj = [...ADJECTIVES].sort((a, b) => b.length - a.length)[0]!;
    const longestNoun = [...NOUNS].sort((a, b) => b.length - a.length)[0]!;
    expect(longestAdj.length + 1 + longestNoun.length).toBeLessThanOrEqual(40);
  });
});
