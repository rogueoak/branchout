// The surface a request is being served on (spec 0035 / feedback 0028): the apex or the insider
// subdomain. Read from the request `Host` header server-side, so a page renders the same on the
// apex and, when the insider host rewrites it into the `/insider` tree, adapts to that surface
// without a separate component. Visibility of an insider-only game (spec 0043) follows the SURFACE,
// not the viewer's entitlement - an insider on the apex must not see an insider game.

import { headers } from 'next/headers';
import { isInsiderHost } from './subdomain';

export interface Surface {
  /** True when this request is served on the insider subdomain. */
  insider: boolean;
  /**
   * The apex origin for shared chrome to cross its marketing/legal links back to (feedback 0019).
   * Empty on the apex (links stay relative); the apex origin (`NEXT_PUBLIC_SITE_URL`) on the insider
   * surface, where a relative `/games` would otherwise rewrite into the insider tree and 404.
   */
  linkOrigin: string;
}

/** Resolve the current request's surface from its `Host` header. Server Components only. */
export async function getSurface(): Promise<Surface> {
  const host = (await headers()).get('host');
  const insider = isInsiderHost(host);
  const apexOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  return { insider, linkOrigin: insider ? apexOrigin : '' };
}
