/**
 * Email handling for accounts. Emails are the login identity, so they are normalized
 * (trimmed + lowercased) for case-insensitive uniqueness and given a light shape check. Full
 * deliverability / verification is a follow-up (see spec 0004 "email verification stub").
 */

export const EMAIL_MAX = 254;

// A deliberately permissive shape check: one `@`, non-empty local and domain parts, a dot in
// the domain, no spaces. Real validation is delivery; this just catches obvious mistakes.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailResult {
  ok: boolean;
  /** The normalized email (trimmed + lowercased) when valid. */
  normalized?: string;
  error?: string;
}

/** Normalize an email for storage and comparison: trim surrounding space, lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Validate an email's shape and return its normalized form. */
export function validateEmail(raw: string): EmailResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Email is required.' };
  }
  const normalized = normalizeEmail(raw);
  if (normalized.length === 0 || normalized.length > EMAIL_MAX) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  return { ok: true, normalized };
}
