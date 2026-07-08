import { describe, expect, it } from 'vitest';
import { toDisplayAnswer } from './title-case';

describe('toDisplayAnswer', () => {
  it('capitalizes each significant word (proper nouns get caps)', () => {
    expect(toDisplayAnswer('albert einstein')).toBe('Albert Einstein');
    expect(toDisplayAnswer('carbon dioxide')).toBe('Carbon Dioxide');
    expect(toDisplayAnswer('pacific ocean')).toBe('Pacific Ocean');
  });

  it('keeps minor words lowercase inside a title but caps the first and last', () => {
    expect(toDisplayAnswer('the lord of the rings')).toBe('The Lord of the Rings');
    expect(toDisplayAnswer('the beatles')).toBe('The Beatles');
    expect(toDisplayAnswer('a tale of two cities')).toBe('A Tale of Two Cities');
  });

  it('capitalizes the first alphanumeric char past leading punctuation', () => {
    expect(toDisplayAnswer('(new) york')).toBe('(New) York');
  });

  it('leaves an author-supplied interior capital untouched', () => {
    expect(toDisplayAnswer('McQueen')).toBe('McQueen');
  });

  it('is a no-op on blank input', () => {
    expect(toDisplayAnswer('')).toBe('');
    expect(toDisplayAnswer('   ')).toBe('');
  });

  it('fixes common stylized forms via the allowlist', () => {
    expect(toDisplayAnswer('co2')).toBe('CO2');
    expect(toDisplayAnswer('nasa')).toBe('NASA');
    expect(toDisplayAnswer('iphone')).toBe('iPhone');
    // Applied per word, inside a longer answer.
    expect(toDisplayAnswer('the uk')).toBe('The UK');
    expect(toDisplayAnswer('deoxyribonucleic acid dna')).toBe('Deoxyribonucleic Acid DNA');
  });

  it('cannot recover an unlisted acronym from lowercase (documented best-effort limit)', () => {
    // Not on the allowlist: casing is reconstructed generically, so this becomes 'Fdic', not 'FDIC'.
    expect(toDisplayAnswer('fdic')).toBe('Fdic');
  });
});
