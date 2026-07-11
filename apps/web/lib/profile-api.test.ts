import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProfile } from './profile-api';

describe('fetchProfile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the profile from a 200 and hits the versioned public endpoint', async () => {
    const profile = { gamerTag: 'AdaL', totalStars: 5, visibility: 'public', restricted: false };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ profile }), { status: 200 }));

    const result = await fetchProfile('AdaL');
    expect(result).toEqual(profile);
    // The version prefix and the public path are used.
    expect(fetchSpy.mock.calls[0]![0]).toContain('/v1/profiles/AdaL');
  });

  it('returns null on a 404 (unknown tag)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    expect(await fetchProfile('ghost')).toBeNull();
  });

  it('returns null when the control plane is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    expect(await fetchProfile('AdaL')).toBeNull();
  });
});
