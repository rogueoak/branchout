import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  apexLoginUrl,
  insiderRewritePath,
  isInsiderHost,
  isPublicAuthPath,
  schemeFrom,
} from './lib/subdomain';

// Host-aware routing for the subdomain surfaces (spec 0035). The insider host is served by this
// same `web` process: middleware invisibly rewrites its requests into the `/insider` route tree,
// and the tree's layout is the authoritative gate (host + role). This middleware only routes (plus a
// cheap signed-out shortcut); it is not the authorization boundary. Admin is a separate static app
// (spec 0037), so it never reaches here.

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get('host');
  const url = req.nextUrl;

  if (isInsiderHost(host)) {
    const h = host as string;
    // The public auth pages stay reachable on the insider host without a session - they are the
    // escape hatch a signed-out visitor uses to sign in. Serving them un-rewritten (there is no
    // `/insider/login` page) also breaks the redirect loop: a cross-subdomain apex-login redirect is
    // collapsed to a host-relative `/login` by Next's edge runtime, so without this the visitor would
    // bounce off the gate forever (see isPublicAuthPath). These are public pages; serving them on the
    // insider host leaks nothing, and the `/insider/*` app tree stays gated by the layout.
    if (isPublicAuthPath(url.pathname)) {
      return NextResponse.next();
    }
    // No session at all -> the APEX login (crossing off the gated host, which would otherwise
    // rewrite the login page back into the insider tree), carrying an origin-validated return
    // target. The insider layout does the authoritative role check; this only short-circuits the
    // anonymous case at the edge.
    if (!req.cookies.get(SESSION_COOKIE_NAME)) {
      const scheme = schemeFrom(
        req.headers.get('x-forwarded-proto'),
        url.protocol.replace(/:$/, ''),
      );
      const nextUrl = `${scheme}://${h}${url.pathname}${url.search}`;
      const target = apexLoginUrl(h, scheme, nextUrl);
      // `apexLoginUrl` returns a relative `/login` for an untrusted (spoofed) host - resolve it
      // against the caller's own origin so we never build an absolute redirect to a stripped host.
      return NextResponse.redirect(target.startsWith('/') ? new URL(target, req.url) : target);
    }
    // Invisible rewrite into the insider tree, preserving the query string.
    const rewritten = new URL(req.url);
    rewritten.pathname = insiderRewritePath(url.pathname);
    return NextResponse.rewrite(rewritten);
  }

  // On the apex, a direct `/insider*` request is NOT 404'd here: the insider layout host-guards
  // and renders the styled 404 (`notFound()`), so the guard and the auth gate live in one place.
  return NextResponse.next();
}

export const config = {
  // Run on pages only: skip the API proxy, Next internals, the PostHog /ingest proxy, and any path
  // with a file extension (static assets).
  matcher: ['/((?!api|_next|ingest|.*\\..*).*)'],
};
