import { cookies } from 'next/headers';
import { LandingContent } from '../components/LandingContent';

// Server-side control-plane URL (not exposed to the browser).
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

// Cookie name must match what the control-plane writes (env SESSION_COOKIE_NAME; default
// matches control-plane config.ts).
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'branchout_session';

/**
 * Check whether the current request carries a valid account session.
 * Fails gracefully: any network or parse error defaults to the anonymous view so the
 * landing page remains useful even when the control plane is unreachable.
 */
async function getSignedIn(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionId) return false;

    const res = await fetch(`${CONTROL_PLANE_URL}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
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

// Home page: the Branch out marketing landing page (spec 0005). Server-rendered so the
// signed-in vs anonymous CTA swap happens before the first byte, with no layout shift.
export default async function HomePage() {
  const signedIn = await getSignedIn();
  return <LandingContent signedIn={signedIn} />;
}
