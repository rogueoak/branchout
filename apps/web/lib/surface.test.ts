import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSurface } from './surface';

// Mock next/headers so the request Host is controllable in a unit test - getSurface reads it to
// decide the surface. The factory returns a settable holder so each test picks the inbound host.
const hostHolder: { value: string | null } = { value: null };
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'host' ? hostHolder.value : null) }),
}));

describe('getSurface (feedback 0029)', () => {
  afterEach(() => {
    hostHolder.value = null;
    vi.unstubAllEnvs();
  });

  it('reports the apex surface (no insider, relative chrome) on the apex host', async () => {
    hostHolder.value = 'branchout.games';
    expect(await getSurface()).toEqual({ insider: false, linkOrigin: '' });
  });

  it('reports the insider surface with the apex link origin on the insider host', async () => {
    hostHolder.value = 'insider.branchout.games';
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games');
    expect(await getSurface()).toEqual({ insider: true, linkOrigin: 'https://branchout.games' });
  });

  it('matches the insider host in local/e2e (insider.localhost)', async () => {
    hostHolder.value = 'insider.localhost:3100';
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3100');
    expect(await getSurface()).toEqual({ insider: true, linkOrigin: 'http://localhost:3100' });
  });

  it('strips a trailing slash from the site URL so linkOrigin is a bare origin', async () => {
    // A trailing-slashed NEXT_PUBLIC_SITE_URL must not double the slash when chrome builds
    // `${linkOrigin}/games` - the strip is load-bearing, so pin it.
    hostHolder.value = 'insider.branchout.games';
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games/');
    expect(await getSurface()).toEqual({ insider: true, linkOrigin: 'https://branchout.games' });
  });

  it('never carries a link origin on the apex, even when the site URL is set', async () => {
    hostHolder.value = 'branchout.games';
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games');
    expect(await getSurface()).toEqual({ insider: false, linkOrigin: '' });
  });
});
