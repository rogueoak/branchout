import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewer } from '../../lib/session';
import { apexLoginUrl, isInsidersHost } from '../../lib/subdomain';

// The authoritative gate for the insiders surface (spec 0035). Middleware routes the `insiders` host
// into this tree and short-circuits the fully-anonymous case; this layout is the real check, run
// server-side on every insiders page:
//   - not signed in (no session, or a stale/expired/anonymous one that slipped past middleware's
//     cheap cookie-presence check) -> the APEX login. We cross to the apex rather than this host's
//     /login so we never loop back through the gated tree.
//   - signed in but not an insider -> `forbidden()`, a real 403 (see app/forbidden.tsx).
export default async function InsidersLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();

  if (!viewer.signedIn) {
    const h = await headers();
    const host = h.get('host') ?? '';
    // Caddy sets x-forwarded-proto in prod; dev talks plain http to web, so fall back to http.
    const scheme = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
    redirect(isInsidersHost(host) ? apexLoginUrl(host, scheme) : '/login');
  }

  if (!viewer.insider) {
    forbidden();
  }

  return <>{children}</>;
}
