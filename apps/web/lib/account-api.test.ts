import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountApiError, logout, setAvatar, setVisibility } from './account-api';

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('account-api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setAvatar PATCHes the versioned endpoint with credentials and returns the account', async () => {
    const account = {
      id: 'a1',
      gamerTag: 'AdaL',
      nickname: 'Ada',
      avatar: 'frog',
      visibility: 'public',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ account }));

    const result = await setAvatar('frog');
    expect(result).toEqual(account);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('/v1/auth/avatar');
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'include' });
    expect(JSON.parse(init!.body as string)).toEqual({ avatar: 'frog' });
  });

  it('setVisibility sends the chosen value', async () => {
    const account = {
      id: 'a1',
      gamerTag: 'AdaL',
      nickname: 'Ada',
      avatar: 'frog',
      visibility: 'private',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ account }));
    await setVisibility('private');
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({
      visibility: 'private',
    });
  });

  it('maps a non-ok response to an AccountApiError carrying the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Sign in to change your avatar.' }), { status: 401 }),
    );
    const err = await setAvatar('frog').catch((e) => e);
    expect(err).toBeInstanceOf(AccountApiError);
    expect((err as AccountApiError).status).toBe(401);
    expect((err as AccountApiError).message).toBe('Sign in to change your avatar.');
  });

  it('logout POSTs the versioned logout endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson({ ok: true }));
    await logout();
    expect(fetchSpy.mock.calls[0]![0]).toContain('/v1/auth/logout');
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });
});
