// Host-aware routing helpers for the subdomain surfaces (spec 0035). Pure functions, so the
// middleware stays a thin adapter over `next/server` and the routing logic is unit-testable without
// mocking the Next runtime. Today only `insider.` exists; the admin console (spec 0037) is a
// separate static app served by Caddy, so it never reaches this Next middleware.

/** The subdomain label that selects the insider surface. */
export const INSIDER_PREFIX = 'insider.';

/** The internal segment the insider host rewrites into. */
export const INSIDER_SEGMENT = '/insider';

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
 * Whether a request is for the insider surface. Matches `insider.branchout.games` and
 * `insider.localhost[:port]` alike (a bare-label check, so it works in prod and in local/e2e where
 * `*.localhost` resolves to 127.0.0.1).
 */
export function isInsiderHost(hostHeader: string | null | undefined): boolean {
  return hostname(hostHeader).startsWith(INSIDER_PREFIX);
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
 * The apex host for an insider host, keeping any port, lowercased. `insider.branchout.games` ->
 * `branchout.games`; `insider.localhost:3100` -> `localhost:3100`. Only the leading label is
 * stripped.
 */
export function apexHost(hostHeader: string): string {
  return hostHeader.replace(/^insider\./i, '').toLowerCase();
}

/**
 * The insider origin for a given apex origin - the inverse of `apexHost`, for building an outbound
 * link from the apex (e.g. the account page) to the insider surface. `https://branchout.games` ->
 * `https://insider.branchout.games`; `http://localhost:3100` -> `http://insider.localhost:3100`.
 * Reuses `INSIDER_PREFIX` so the dev/e2e and prod hosts both fall out of the origin. A trailing
 * slash is ignored; a non-URL input is returned unchanged (defensive - the caller falls back to a
 * relative link rather than crashing the page).
 */
export function insiderOrigin(apexOrigin: string): string {
  const trimmed = apexOrigin.replace(/\/$/, '');
  try {
    const url = new URL(trimmed);
    url.hostname = `${INSIDER_PREFIX}${url.hostname}`;
    return url.origin;
  } catch {
    return trimmed;
  }
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
 * The login URL a signed-out insider visitor is sent to. Redirecting to the insider host's own
 * `/login` would just rewrite the login page back into the gated tree, so a trusted insider host
 * crosses back to the APEX login; an optional origin-validated `nextUrl` rides along as `?next=` so
 * login can return the visitor to the surface. If the insider `host` itself is not one of ours
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
 * The internal path the insider host serves for a public path. `/` -> `/insider`; `/games` ->
 * `/insider/games`. Idempotent: an already-prefixed path is returned unchanged, so an accidental
 * double rewrite can never happen.
 */
export function insiderRewritePath(pathname: string): string {
  if (isInsiderPath(pathname)) return pathname;
  if (pathname === '/') return INSIDER_SEGMENT;
  return `${INSIDER_SEGMENT}${pathname}`;
}

/** Whether a path targets the insider tree - used by the layout host-guard. */
export function isInsiderPath(pathname: string): boolean {
  return pathname === INSIDER_SEGMENT || pathname.startsWith(`${INSIDER_SEGMENT}/`);
}

/**
 * The public auth routes that must stay reachable on the insider host WITHOUT a session - the
 * escape hatch a signed-out visitor needs to actually sign in.
 *
 * Without this exemption the insider gate loops: a signed-out insider `/join` is redirected to the
 * apex `/login`, but Next's dev/edge runtime collapses a cross-subdomain redirect between two
 * `*.localhost` (or two `*.branchout.games`) hosts to a HOST-RELATIVE `Location` (`/login?...`).
 * The browser resolves that against the insider host it is already on, so `/login` re-enters the
 * gate, is signed-out again, and redirects to itself forever (ERR_TOO_MANY_REDIRECTS). Serving these
 * routes directly on the insider host (no gate, no rewrite - there is no `/insider/login` page) gives
 * the visitor a real login page and breaks the loop. They are public pages, so serving them on the
 * insider host leaks nothing; the `/insider/*` tree stays gated by the layout.
 */
export function isPublicAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup';
}
