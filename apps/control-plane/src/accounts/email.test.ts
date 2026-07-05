import { describe, expect, it } from 'vitest';
import { normalizeEmail, validateEmail } from './email';

describe('email normalization', () => {
  it('trims and lowercases for case-insensitive uniqueness', () => {
    expect(normalizeEmail('  Player@Example.COM ')).toBe('player@example.com');
  });
});

describe('email validation', () => {
  it('accepts a plausible email and returns the normalized form', () => {
    const result = validateEmail('Player@Example.com');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('player@example.com');
  });

  it('rejects obviously malformed input', () => {
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validateEmail('missing@domain').ok).toBe(false);
    expect(validateEmail('@example.com').ok).toBe(false);
    expect(validateEmail('spaces in@example.com').ok).toBe(false);
    expect(validateEmail('').ok).toBe(false);
  });
});
