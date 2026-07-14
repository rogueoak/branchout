/**
 * Validation + normalization for the subscribe endpoint (spec 0047). Pure and I/O-free so it is
 * unit-tested without booting a server (the route is a thin shell over this, mirroring rogueoak's
 * `lib/subscribe`). The email shape check reuses the account `validateEmail` so the whole service has
 * one permissive email rule; the optional name is trimmed and length-capped here.
 */

import { validateEmail } from '../accounts/email';

/** A validated, normalized submission. `name` is the raw (trimmed, capped) free-text name, may be ''. */
export type SubscribeData = { email: string; name: string };
export type SubscribeValidation = { ok: true; data: SubscribeData } | { ok: false; error: string };

/** The Constant Contact `first_name`/`last_name` split of a free-text name. */
export type NameParts = { firstName?: string; lastName?: string };

// Raw-input caps so a payload can never be unbounded. `name` bounds the raw free-text field; `part`
// is the CTCT first_name/last_name field limit, so a split part never overflows the API.
export const SUBSCRIBE_LIMITS = { name: 100, part: 50 } as const;

/**
 * Cap a string to at most `n` Unicode code points (not UTF-16 units), so a hard slice can never split
 * an astral character (an emoji, a rare CJK glyph) into a lone surrogate.
 */
function capChars(str: string, n: number): string {
  const cp = Array.from(str);
  return cp.length > n ? cp.slice(0, n).join('') : str;
}

/**
 * Validate + normalize a raw submission. The email is required and normalized (trim + lowercase) via
 * the shared account validator; the `name` is OPTIONAL - trimmed and length-capped, but a missing or
 * empty name still validates and subscribes.
 */
export function validateSubscribe(input: { email?: unknown; name?: unknown }): SubscribeValidation {
  const rawEmail = typeof input.email === 'string' ? input.email : '';
  const emailResult = validateEmail(rawEmail);
  if (!emailResult.ok || !emailResult.normalized) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const name =
    typeof input.name === 'string' ? capChars(input.name.trim(), SUBSCRIBE_LIMITS.name) : '';
  return { ok: true, data: { email: emailResult.normalized, name } };
}

/**
 * Split an optional free-text name into Constant Contact first/last name parts. Low-friction single
 * field: the FIRST whitespace-separated token is the first name and the remainder (if any) is the last
 * name (a middle name folds into the last name, which is fine). Trims, collapses internal whitespace,
 * caps each part at the CTCT field limit, and omits empty parts - so an empty name yields `{}` and adds
 * nothing to the payload.
 */
export function splitName(name: unknown): NameParts {
  const norm = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!norm) {
    return {};
  }
  const sp = norm.indexOf(' ');
  const first = capChars(sp === -1 ? norm : norm.slice(0, sp), SUBSCRIBE_LIMITS.part);
  const rest = sp === -1 ? '' : capChars(norm.slice(sp + 1), SUBSCRIBE_LIMITS.part);
  const parts: NameParts = {};
  if (first) {
    parts.firstName = first;
  }
  if (rest) {
    parts.lastName = rest;
  }
  return parts;
}
