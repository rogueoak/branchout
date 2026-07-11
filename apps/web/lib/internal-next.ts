/**
 * Validate a post-signup `next` redirect target. Only a same-origin absolute PATH is allowed (starts
 * with a single "/", not the protocol-relative "//", no scheme or backslash), so a feature-page CTA
 * can carry the intended game (`/rooms?game=<slug>`) through signup while an attacker cannot bounce a
 * fresh account to an external URL. Returns the path, or null to fall back to the default landing.
 *
 * Lives in its own module (not the signup page) because a Next.js page file may export only the
 * default component and route config - a named helper export breaks the page-type contract.
 */
export function internalNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}
