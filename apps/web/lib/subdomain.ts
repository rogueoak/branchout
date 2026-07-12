// Host-aware routing helpers for the subdomain surfaces (spec 0035). Pure functions, so the
// middleware stays a thin adapter over `next/server` and the routing logic is unit-testable without
// mocking the Next runtime. Today only `insiders.` exists; the admin console (spec 0037) is a
// separate static app served by Caddy, so it never reaches this Next middleware.

/** The subdomain label that selects the insiders surface. */
export const INSIDERS_PREFIX = 'insiders.';

/** The internal segment the insiders host rewrites into. */
export const INSIDERS_SEGMENT = '/insiders';

/** The bare hostname (no port), lowercased, from a raw `Host` header value. */
export function hostname(hostHeader: string | null | undefined): string {
  return ((hostHeader ?? '').split(':')[0] ?? '').toLowerCase();
}

/**
 * Whether a request is for the insiders surface. Matches `insiders.branchout.games` and
 * `insiders.localhost[:port]` alike (a bare-label check, so it works in prod and in local/e2e where
 * `*.localhost` resolves to 127.0.0.1).
 */
export function isInsidersHost(hostHeader: string | null | undefined): boolean {
  return hostname(hostHeader).startsWith(INSIDERS_PREFIX);
}

/**
 * The apex host for an insiders host, keeping any port. `insiders.branchout.games` ->
 * `branchout.games`; `insiders.localhost:3100` -> `localhost:3100`. Only the leading label is
 * stripped.
 */
export function apexHost(hostHeader: string): string {
  return hostHeader.replace(/^insiders\./i, '');
}

/**
 * The absolute apex login URL a signed-out insiders visitor is sent to. Redirecting to the insiders
 * host's own `/login` would just rewrite the login page back into the gated tree, so we cross back
 * to the apex. `scheme` comes from `x-forwarded-proto` (Caddy terminates TLS) with the request's own
 * protocol as the dev fallback.
 */
export function apexLoginUrl(hostHeader: string, scheme: string): string {
  return `${scheme}://${apexHost(hostHeader)}/login`;
}

/**
 * The internal path the insiders host serves for a public path. `/` -> `/insiders`; `/games` ->
 * `/insiders/games`. Idempotent: an already-prefixed path is returned unchanged, so an accidental
 * double rewrite can never happen.
 */
export function insidersRewritePath(pathname: string): string {
  if (isInsidersPath(pathname)) return pathname;
  if (pathname === '/') return INSIDERS_SEGMENT;
  return `${INSIDERS_SEGMENT}${pathname}`;
}

/** Whether a path targets the insiders tree - used to 404 direct access from the apex. */
export function isInsidersPath(pathname: string): boolean {
  return pathname === INSIDERS_SEGMENT || pathname.startsWith(`${INSIDERS_SEGMENT}/`);
}
