import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSignedIn, getViewer } from './session';

const ACCOUNT_ME = {
  kind: 'account',
  account: { gamerTag: 'CoolCat', nickname: 'Cat', avatar: 'fox' },
};

// Mock next/headers so getSignedIn's cookie read is controllable in a unit test. The factory
// returns a settable holder so each test picks the session id the request carries.
const cookieHolder: { value: string | undefined } = { value: undefined };
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieHolder.value === undefined ? undefined : { value: cookieHolder.value }),
  }),
}));

describe('getSignedIn - server-side session check', () => {
  afterEach(() => {
    cookieHolder.value = undefined;
    vi.restoreAllMocks();
  });

  it('returns false when no session cookie is present, without calling the control plane', async () => {
    cookieHolder.value = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getSignedIn()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true when the control plane reports an account session', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ACCOUNT_ME }));
    expect(await getSignedIn()).toBe(true);
  });

  it('getViewer returns the account identity the nav needs for an account session', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ACCOUNT_ME }));
    expect(await getViewer()).toEqual({
      signedIn: true,
      gamerTag: 'CoolCat',
      nickname: 'Cat',
      avatar: 'fox',
      // Absent in the /auth/me payload -> defaults to a non-insider (spec 0035).
      insider: false,
    });
  });

  it('getViewer carries the insider flag when the account is a beta tester (spec 0035)', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kind: 'account', account: { ...ACCOUNT_ME.account, insider: true } }),
      }),
    );
    expect((await getViewer()).insider).toBe(true);
  });

  it('getViewer is signed-out for an account kind that carries no account object', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'account' }) }),
    );
    expect(await getViewer()).toEqual({ signedIn: false });
  });

  it('returns false for a non-account (e.g. anonymous) session', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'anonymous' }) }),
    );
    expect(await getSignedIn()).toBe(false);
  });

  it('returns false when the control plane responds non-ok', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await getSignedIn()).toBe(false);
  });

  it('returns false (anonymous view) when the control plane is unreachable', async () => {
    cookieHolder.value = 'sid-123';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await getSignedIn()).toBe(false);
  });

  it('encodes the cookie value into the request header', async () => {
    cookieHolder.value = 'sid with spaces';
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ kind: 'account' }) });
    vi.stubGlobal('fetch', fetchMock);
    await getSignedIn();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).cookie).toContain('sid%20with%20spaces');
  });
});
