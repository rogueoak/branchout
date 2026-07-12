import { NextResponse, type NextRequest } from 'next/server';

// Cheap edge gate: an authed area needs an admin cookie present. The authoritative check is
// server-side in each page (requireAdmin -> getAdmin), which rejects a stale/invalid cookie; this
// only short-circuits the fully-signed-out case before rendering. The login/health/api/static paths
// are open (matcher excludes them).
const ADMIN_COOKIE = process.env.ADMIN_SESSION_COOKIE_NAME ?? 'branchout_admin_session';

export function middleware(req: NextRequest): NextResponse {
  if (!req.cookies.get(ADMIN_COOKIE)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api|_next|health|.*\\..*).*)'],
};
