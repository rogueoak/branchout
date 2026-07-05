import { describe, expect, it } from 'vitest';
import { normalizeGamerTag, validateGamerTag } from './gamertag';

describe('gamer tag normalization', () => {
  it('trims and lowercases so uniqueness is case-insensitive', () => {
    expect(normalizeGamerTag('  CoolCat42 ')).toBe('coolcat42');
    expect(normalizeGamerTag('COOLCAT42')).toBe('coolcat42');
  });
});

describe('gamer tag validation', () => {
  it('accepts a valid tag and returns the normalized value', () => {
    const result = validateGamerTag('Cool_Cat-42');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('cool_cat-42');
  });

  it('rejects a tag that is too short', () => {
    expect(validateGamerTag('ab').ok).toBe(false);
  });

  it('rejects a tag that is too long', () => {
    expect(validateGamerTag('a'.repeat(21)).ok).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(validateGamerTag('cool cat').ok).toBe(false);
    expect(validateGamerTag('cool.cat').ok).toBe(false);
    expect(validateGamerTag('cool@cat').ok).toBe(false);
  });

  it('treats tags differing only by case as the same normalized value', () => {
    expect(validateGamerTag('PlayerOne').normalized).toBe(validateGamerTag('playerone').normalized);
  });
});
