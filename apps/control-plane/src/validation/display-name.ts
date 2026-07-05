/**
 * Display-name validation - domain-neutral. Both an account nickname and an anonymous session's
 * display name are the same kind of free-form, human-readable text, so the rule lives here and
 * neither the accounts module nor the sessions flow depends on the other for it. A display name
 * defaults (for an account) to the gamer tag, need not be unique, and just has to be a sane
 * length and free of control characters.
 */

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 40;

export interface DisplayNameResult {
  ok: boolean;
  /** The trimmed value when valid. */
  value?: string;
  error?: string;
}

/**
 * True if the string contains any ASCII/Unicode C0 or C1 control character (line breaks, null,
 * escape, etc.). Such characters could smuggle formatting or break rendering, so a display name
 * must not carry them. Checked by code point to keep the source ASCII-clean.
 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Validate a display name and return its trimmed form. */
export function validateDisplayName(raw: string): DisplayNameResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'A display name is required.' };
  }
  const value = raw.trim();
  if (value.length < DISPLAY_NAME_MIN || value.length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      error: `Name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} characters.`,
    };
  }
  if (hasControlChars(value)) {
    return { ok: false, error: 'Name contains invalid characters.' };
  }
  return { ok: true, value };
}
