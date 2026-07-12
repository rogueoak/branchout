// Host-aware routing helpers for the subdomain surfaces (spec 0035). Pure functions, so the
// middleware stays a thin adapter over `next/server` and the routing logic is unit-testable without
// mocking the Next runtime. Today only `insiders.` exists; the admin console (spec 0037) is a
// separate static app served by Caddy, so it never reaches this Next middleware.

/** The subdomain label that selects the insiders surface. */
export const INSIDERS_PREFIX = 'insiders.';

/** The internal segment the insiders host rewrites into. */
export const INSIDERS_SEGMENT = '/insiders';

/**
 * The session cookie name. Owned here (a pure module with no server deps) so the edge middleware and
 * the SSR `lib/session` share ONE default instead of each reading `process.env.SESSION_COOKIE_NAME`
 * - which configures the control-plane, not web, so a drift there would silently break the edge
 * redirect. The control-plane's own default (config.ts) must match this literal.
 */
export const SESSION_COOKIE_NAME = 'branchout_session';

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
 * Whether a host is one of ours - `branchout.games` (+ subdomains) or `localhost` (+ `*.localhost`
 * for local/e2e). Used to gate redirects built from the untrusted `Host` header: we never send a
 * user to a host derived from a header we do not control (Host-header open-redirect defence). Any
 * port is ignored.
 */
export function isTrustedHost(hostHeader: string | null | undefined): boolean {
  const h = hostname(hostHeader);
  return (
    h === 'branchout.games' ||
    h.endsWith('.branchout.games') ||
    h === 'localhost' ||
    h.endsWith('.localhost')
  );
}

/**
 * The request scheme, preferring `x-forwarded-proto` (Caddy terminates TLS at the edge) and falling
 * back to the given value (the request's own protocol) for direct/dev traffic. The header can carry
 * a comma-separated list; the first entry is the client-facing scheme.
 */
export function schemeFrom(xForwardedProto: string | null | undefined, fallback: string): string {
  return xForwardedProto?.split(',')[0]?.trim() || fallback;
}

/**
 * The apex host for an insiders host, keeping any port, lowercased. `insiders.branchout.games` ->
 * `branchout.games`; `insiders.localhost:3100` -> `localhost:3100`. Only the leading label is
 * stripped.
 */
export function apexHost(hostHeader: string): string {
  return hostHeader.replace(/^insiders\./i, '').toLowerCase();
}

/** Whether a `next` return-target URL points at one of our own hosts (so it is safe to redirect to). */
function isTrustedNextUrl(nextUrl: string): boolean {
  try {
    return isTrustedHost(new URL(nextUrl).host);
  } catch {
    return false;
  }
}

/**
 * The login URL a signed-out insiders visitor is sent to. Redirecting to the insiders host's own
 * `/login` would just rewrite the login page back into the gated tree, so a trusted insiders host
 * crosses back to the APEX login; an optional origin-validated `nextUrl` rides along as `?next=` so
 * login can return the visitor to the surface. If the insiders `host` itself is not one of ours
 * (a spoofed `Host` header - never reachable through Caddy in prod), we do NOT build an absolute URL
 * from it; we return a relative `/login` the caller resolves against its own origin, closing a
 * Host-header open redirect.
 */
export function apexLoginUrl(host: string, scheme: string, nextUrl?: string): string {
  if (!isTrustedHost(host)) return '/login';
  const base = `${scheme}://${apexHost(host)}/login`;
  return nextUrl && isTrustedNextUrl(nextUrl)
    ? `${base}?next=${encodeURIComponent(nextUrl)}`
    : base;
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

/** Whether a path targets the insiders tree - used by the layout host-guard. */
export function isInsidersPath(pathname: string): boolean {
  return pathname === INSIDERS_SEGMENT || pathname.startsWith(`${INSIDERS_SEGMENT}/`);
}
