/**
 * A nickname is free-form display text. It defaults to the gamer tag and can be changed to
 * anything readable. Unlike the gamer tag it need not be unique; it just has to be a sane
 * length and free of control characters.
 */

export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 40;

export interface NicknameResult {
  ok: boolean;
  /** The trimmed nickname when valid. */
  value?: string;
  error?: string;
}

/**
 * True if the string contains any ASCII/Unicode C0 or C1 control character (line breaks,
 * null, escape, etc.). Such characters could smuggle formatting or break rendering, so a
 * display name must not carry them. Checked by code point to keep the source ASCII-clean.
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

/** Validate a nickname and return its trimmed form. */
export function validateNickname(raw: string): NicknameResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Nickname is required.' };
  }
  const value = raw.trim();
  if (value.length < NICKNAME_MIN || value.length > NICKNAME_MAX) {
    return { ok: false, error: `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters.` };
  }
  if (hasControlChars(value)) {
    return { ok: false, error: 'Nickname contains invalid characters.' };
  }
  return { ok: true, value };
}
