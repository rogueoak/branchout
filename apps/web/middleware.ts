import { NextResponse, type NextRequest } from 'next/server';
import { apexLoginUrl, insidersRewritePath, isInsidersHost, isInsidersPath } from './lib/subdomain';

// Host-aware routing for the subdomain surfaces (spec 0035). The insiders host is served by this
// same `web` process: middleware invisibly rewrites its requests into the `/insiders` route tree,
// and the tree's layout is the authoritative role gate. This middleware only routes (plus a cheap
// signed-out shortcut); it is not the authorization boundary. Admin is a separate static app (spec
// 0037), so it never reaches here.

// Must match the cookie the control-plane writes (config.ts SESSION_COOKIE_NAME; same default).
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'branchout_session';

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get('host');
  const url = req.nextUrl;

  if (isInsidersHost(host)) {
    // No session at all -> the APEX login (crossing off the gated host, which would otherwise
    // rewrite the login page back into the insiders tree). The insiders layout does the
    // authoritative insider-role check; this only short-circuits the anonymous case at the edge.
    if (!req.cookies.get(SESSION_COOKIE)) {
      const scheme =
        req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
        url.protocol.replace(/:$/, '');
      return NextResponse.redirect(apexLoginUrl(host as string, scheme));
    }
    // Invisible rewrite into the insiders tree, preserving the query string.
    const rewritten = new URL(req.url);
    rewritten.pathname = insidersRewritePath(url.pathname);
    return NextResponse.rewrite(rewritten);
  }

  // The apex (and www) must not reach the insiders tree by typing its internal path.
  if (isInsidersPath(url.pathname)) {
    return new NextResponse('Not found', { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  // Run on pages only: skip the API proxy, Next internals, the PostHog /ingest proxy, and any path
  // with a file extension (static assets).
  matcher: ['/((?!api|_next|ingest|.*\\..*).*)'],
};
