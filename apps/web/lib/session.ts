import { V1_PREFIX } from '@branchout/protocol';
import { cookies } from 'next/headers';

// Server-side control-plane URL (not exposed to the browser).
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

// Cookie name must match what the control-plane writes (env SESSION_COOKIE_NAME; default
// matches control-plane config.ts).
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'branchout_session';

/**
 * The signed-in identity the top nav needs (spec 0028), read server-side so the correct nav renders
 * on the first byte (no signed-in/out flash). `signedIn` is false for anonymous/unauthenticated
 * sessions; the identity fields are present only for an account session.
 */
export interface Viewer {
  signedIn: boolean;
  gamerTag?: string;
  nickname?: string;
  avatar?: string;
}

const SIGNED_OUT: Viewer = { signedIn: false };

/**
 * Read the current request's account identity from the control-plane `/auth/me` endpoint. Fails
 * gracefully: any missing cookie, non-ok response, network error, or parse error returns a signed-out
 * viewer, so a caller can default to the anonymous nav even when the control plane is unreachable. A
 * non-account session (e.g. anonymous join-by-code) is not "signed in". Uses the server-side
 * `CONTROL_PLANE_URL` (the client/server URL split), never the browser value.
 */
export async function getViewer(): Promise<Viewer> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionId) return SIGNED_OUT;

    const res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/auth/me`, {
      // Encode the cookie value defensively: a raw value carrying a `;`, `,`, or `=` would malform
      // the header. Session ids are base64url today, but the encode keeps the boundary robust.
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}` },
      cache: 'no-store',
    });
    if (!res.ok) return SIGNED_OUT;

    const data = (await res.json()) as {
      kind?: string;
      account?: { gamerTag?: string; nickname?: string; avatar?: string };
    };
    if (data.kind !== 'account' || !data.account) return SIGNED_OUT;
    return {
      signedIn: true,
      gamerTag: data.account.gamerTag,
      nickname: data.account.nickname,
      avatar: data.account.avatar,
    };
  } catch {
    // Control plane unreachable or session check failed - show the anonymous view.
    return SIGNED_OUT;
  }
}

/**
 * Whether the current request carries a valid account session. Thin wrapper over {@link getViewer}
 * for callers that only need the boolean (e.g. the landing CTA swap).
 */
export async function getSignedIn(): Promise<boolean> {
  return (await getViewer()).signedIn;
}
