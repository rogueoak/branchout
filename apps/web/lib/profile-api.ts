// Server-side read of a public profile (spec 0027) for the `/u/[gamerTag]` page. Runs in a Server
// Component, so it uses the server-only `CONTROL_PLANE_URL` (service origin), never the browser's
// `NEXT_PUBLIC_*` - the same client/server split `lib/session.ts` uses, and the reason a crawler /
// SSR fetch reaches the API at all (the 0025/0026 learning). The endpoint is public (no cookie),
// and its projection is already visibility-gated server-side, so this just relays what it returns.

import { V1_PREFIX } from '@branchout/protocol';

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

export interface ProfilePlay {
  game: string;
  rank: number;
  stars: number;
  playedAt: string;
}

/** The public profile projection (mirrors the control-plane `PublicProfile`; never carries PII). */
export interface PublicProfile {
  gamerTag: string;
  totalStars: number;
  visibility: 'public' | 'friends-only' | 'private';
  restricted: boolean;
  nickname?: string;
  avatar?: string;
  recentPlays?: ProfilePlay[];
}

/**
 * Fetch a public profile by gamer tag. Returns `null` for an unknown tag (404) or any failure, so
 * the page can render a graceful "not found" instead of erroring.
 */
export async function fetchProfile(gamerTag: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(
      `${CONTROL_PLANE_URL}${V1_PREFIX}/profiles/${encodeURIComponent(gamerTag)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { profile?: PublicProfile };
    return body.profile ?? null;
  } catch {
    return null;
  }
}
