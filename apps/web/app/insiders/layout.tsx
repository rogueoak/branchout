import { headers } from 'next/headers';
import { forbidden, notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getViewer } from '../../lib/session';
import { apexLoginUrl, isInsidersHost, schemeFrom } from '../../lib/subdomain';

// The authoritative gate for the insiders surface (spec 0035). Middleware routes the `insiders` host
// into this tree; this layout is the real check, run server-side on every insiders page:
//   - host guard: this tree is only served via the insiders host. A direct apex `/insiders` request
//     (middleware no longer 404s it) renders the styled 404 here, so the guard and the auth gate live
//     in one place and the 404 carries a real 404 status.
//   - not signed in (no session, or a stale/expired/anonymous one that slipped past middleware's
//     cheap cookie-presence check) -> the APEX login, carrying an origin-validated `next` so login
//     returns the visitor to the surface. We cross to the apex rather than this host's /login so we
//     never loop back through the gated tree.
//   - signed in but not an insider -> `forbidden()`, a real 403 (see app/forbidden.tsx).
export default async function InsidersLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get('host') ?? '';
  if (!isInsidersHost(host)) notFound();

  const viewer = await getViewer();
  const scheme = schemeFrom(h.get('x-forwarded-proto'), 'http');

  if (!viewer.signedIn) {
    redirect(apexLoginUrl(host, scheme, `${scheme}://${host}/`));
  }
  if (!viewer.insider) {
    forbidden();
  }

  return <>{children}</>;
}
