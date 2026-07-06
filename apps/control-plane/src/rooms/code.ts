import { randomInt } from 'node:crypto';

/**
 * The join-code alphabet: uppercase ASCII letters and digits, with the visually ambiguous
 * characters removed so a code read aloud or typed from a screen is unmistakable. Excluded:
 * `O`/`0` and `I`/`1` (and, by the same reasoning that trips people, `L`). Everything here is
 * safe in a URL and easy to say.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Join codes are five characters - short enough to read aloud, long enough to not collide. */
export const CODE_LENGTH = 5;

/** A join code is exactly `CODE_LENGTH` characters, all from `CODE_ALPHABET`. */
export function isValidCode(code: string): boolean {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) {
    return false;
  }
  for (const char of code) {
    if (!CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Generate one random join code. Uses `crypto.randomInt` (not `Math.random`) so a code is not
 * guessable from prior ones - a code is a bearer token to a room. Uniqueness against existing
 * rooms is the caller's job (retry on collision at the unique index).
 */
export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The tap-to-join share link for a code: `/join?code=ABC12`. A relative path so it resolves
 * against whatever origin the web app serves; the web `/join` page (spec 0010) consumes it. The
 * code is normalized to uppercase and URL-encoded defensively even though the alphabet is URL-safe.
 */
export function shareLink(code: string): string {
  return `/join?code=${encodeURIComponent(code.toUpperCase())}`;
}
