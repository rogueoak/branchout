import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, generateCode, isValidCode, shareLink } from './code';

describe('join code', () => {
  it('generates a 5-character code from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('excludes the ambiguous characters O/0 and I/1', () => {
    for (const ambiguous of ['O', '0', 'I', '1']) {
      expect(CODE_ALPHABET.includes(ambiguous)).toBe(false);
    }
  });

  it('produces varied codes (not a constant) so codes are not guessable in sequence', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      codes.add(generateCode());
    }
    // 200 draws from 31^5 (~28.6M) should almost never collide into a tiny set.
    expect(codes.size).toBeGreaterThan(190);
  });

  it('rejects codes of the wrong length or with disallowed characters', () => {
    expect(isValidCode('ABC1')).toBe(false); // too short + ambiguous 1
    expect(isValidCode('ABCDEF')).toBe(false); // too long
    expect(isValidCode('ABCO2')).toBe(false); // contains excluded O
    expect(isValidCode('abcd2')).toBe(false); // lowercase not allowed
    expect(isValidCode('ABCD2')).toBe(true);
  });

  it('builds a /join?code= share link, uppercased and URL-safe', () => {
    expect(shareLink('ABCD2')).toBe('/join?code=ABCD2');
    expect(shareLink('abcd2')).toBe('/join?code=ABCD2');
  });
});
