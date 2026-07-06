import { cookies } from 'next/headers';

// Server-side control-plane URL (not exposed to the browser).
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

// Cookie name must match what the control-plane writes (env SESSION_COOKIE_NAME; default
// matches control-plane config.ts).
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'branchout_session';

/**
 * Check whether the current request carries a valid account session by asking the control-plane
 * `/auth/me` endpoint. Fails gracefully: any missing cookie, non-ok response, network error, or
 * parse error returns false so a caller can default to the anonymous view even when the control
 * plane is unreachable. A non-account session (e.g. anonymous join-by-code) is not "signed in".
 */
export async function getSignedIn(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionId) return false;

    const res = await fetch(`${CONTROL_PLANE_URL}/auth/me`, {
      // Encode the cookie value defensively: a raw value carrying a `;`, `,`, or `=` would malform
      // the header. Session ids are base64url today, but the encode keeps the boundary robust.
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}` },
      cache: 'no-store',
    });
    if (!res.ok) return false;

    const data = (await res.json()) as { kind?: string };
    return data.kind === 'account';
  } catch {
    // Control plane unreachable or session check failed - show the anonymous view.
    return false;
  }
}
