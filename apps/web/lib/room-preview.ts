// Server-side room preview for Open Graph unfurls. This runs during SSR/prerender of the join
// page (generateMetadata), NOT in the browser, so it must reach the control-plane by its
// server-side URL - the same split lib/session.ts relies on. The browser's
// NEXT_PUBLIC_CONTROL_PLANE_URL is wrong here: in production it is a relative `/api` (no fetch
// base off the server) and in Docker it is a published `localhost` port that resolves to the web
// container, not the control-plane. Use the server-only CONTROL_PLANE_URL (service name / origin).

import { V1_PREFIX } from '@branchout/protocol';

// Server-side control-plane URL (not exposed to the browser); mirrors lib/session.ts.
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

/** The public preview of a room - only what a link unfurl needs to pick a share card. */
export interface RoomPreview {
  code: string;
  status: string;
  selectedGame: string | null;
}

/**
 * Fetch a room's public preview by code from the control-plane (no auth; a link crawler is not a
 * room member). Throws on a missing code, a non-ok response, or a network/parse error - the caller
 * (generateMetadata) treats any throw as "no game" and falls back to the generic share card, so a
 * bad or expired code still unfurls as a valid invite.
 */
export async function getRoomPreview(code: string): Promise<RoomPreview> {
  const res = await fetch(
    `${CONTROL_PLANE_URL}${V1_PREFIX}/rooms/${encodeURIComponent(code)}/preview`,
    {
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    throw new Error(`Room preview failed: ${res.status}`);
  }
  const body = (await res.json()) as { preview?: RoomPreview };
  if (!body.preview) {
    throw new Error('Room preview response missing preview');
  }
  return body.preview;
}
