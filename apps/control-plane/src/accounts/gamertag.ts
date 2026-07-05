/**
 * A gamer tag is always public and unique. It is normalized (trimmed + lowercased) for
 * case-insensitive uniqueness and validated against a small character set so it stays a
 * clean, URL-safe handle.
 */

export const GAMER_TAG_MIN = 3;
export const GAMER_TAG_MAX = 20;

/** Allowed gamer-tag characters: letters, digits, underscore, hyphen. */
const GAMER_TAG_PATTERN = /^[a-z0-9_-]+$/;

export interface GamerTagResult {
  ok: boolean;
  /** The normalized value (trimmed + lowercased) when valid. */
  normalized?: string;
  error?: string;
}

/** Normalize a gamer tag for storage and comparison: trim surrounding space, lowercase. */
export function normalizeGamerTag(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Validate and normalize a gamer tag. Uniqueness is enforced elsewhere against the
 * normalized value; this only checks shape.
 */
export function validateGamerTag(raw: string): GamerTagResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Gamer tag is required.' };
  }
  const normalized = normalizeGamerTag(raw);
  if (normalized.length < GAMER_TAG_MIN || normalized.length > GAMER_TAG_MAX) {
    return {
      ok: false,
      error: `Gamer tag must be ${GAMER_TAG_MIN}-${GAMER_TAG_MAX} characters.`,
    };
  }
  if (!GAMER_TAG_PATTERN.test(normalized)) {
    return { ok: false, error: 'Gamer tag may use only letters, numbers, - and _.' };
  }
  return { ok: true, normalized };
}
