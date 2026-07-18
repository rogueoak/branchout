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

  it('picks distinct list entries as the rng advances', () => {
    // 0.5 lands mid-list for both lists.
    const adj = ADJECTIVES[Math.floor(0.5 * ADJECTIVES.length)]!;
    const noun = NOUNS[Math.floor(0.5 * NOUNS.length)]!;
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    expect(generateRandomName(seq(0.5, 0.5))).toBe(`${cap(adj)} ${cap(noun)}`);
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
