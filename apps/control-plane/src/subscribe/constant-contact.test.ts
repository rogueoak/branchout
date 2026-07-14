import { describe, expect, it, vi } from 'vitest';
import {
  addContactToList,
  buildSignUpPayloadFor,
  createTokenCache,
  refreshAccessToken,
  submitSubscription,
} from './constant-contact';

/** A minimal `Response`-like stub for the injected fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const creds = { clientId: 'client-1', refreshToken: 'refresh-1' };

describe('buildSignUpPayloadFor', () => {
  it('marks create_source Contact and carries the configured list ids', () => {
    const payload = buildSignUpPayloadFor('a@b.com', ['list-branch-out']);
    expect(payload).toEqual({
      email_address: 'a@b.com',
      create_source: 'Contact',
      list_memberships: ['list-branch-out'],
    });
  });

  it('adds first/last name only when present', () => {
    expect(buildSignUpPayloadFor('a@b.com', ['l'], { firstName: 'Ada' }).first_name).toBe('Ada');
    expect(buildSignUpPayloadFor('a@b.com', ['l'], {})).not.toHaveProperty('first_name');
  });
});

describe('refreshAccessToken', () => {
  it('POSTs the refresh grant and returns the access token + expiry', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 });
    });
    const { accessToken, expiresInSec } = await refreshAccessToken(creds, fetchImpl as never);
    expect(accessToken).toBe('tok-1');
    expect(expiresInSec).toBe(3600);
    expect(calls[0]!.url).toContain('authz.constantcontact.com');
    expect(String(calls[0]!.init?.body)).toContain('grant_type=refresh_token');
    expect(String(calls[0]!.init?.body)).toContain('refresh_token=refresh-1');
    expect(String(calls[0]!.init?.body)).toContain('client_id=client-1');
  });

  it('throws a status-only error on a non-2xx (never the response body)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'ada@example.com bad' }));
    await expect(refreshAccessToken(creds, fetchImpl as never)).rejects.toThrow(/responded 400/);
    // The thrown message must not leak the CTCT body (which can echo PII).
    await expect(refreshAccessToken(creds, fetchImpl as never)).rejects.not.toThrow(/example.com/);
  });
});

describe('createTokenCache', () => {
  it('mints once and reuses the token until shortly before expiry', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { access_token: 'tok-A', expires_in: 3600 }),
    );
    const cache = createTokenCache(() => clock);

    const first = await cache.getAccessToken(creds, fetchImpl as never);
    const second = await cache.getAccessToken(creds, fetchImpl as never);
    expect(first).toBe('tok-A');
    expect(second).toBe('tok-A');
    // Reused: only ONE mint despite two reads.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Past expiry (minus the 60s skew) it mints again.
    clock = (3600 - 60 + 1) * 1000;
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-B', expires_in: 3600 }));
    const third = await cache.getAccessToken(creds, fetchImpl as never);
    expect(third).toBe('tok-B');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight mint across a cold-cache burst', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { access_token: 'tok-A', expires_in: 3600 }),
    );
    const cache = createTokenCache(() => 0);
    const [a, b, c] = await Promise.all([
      cache.getAccessToken(creds, fetchImpl as never),
      cache.getAccessToken(creds, fetchImpl as never),
      cache.getAccessToken(creds, fetchImpl as never),
    ]);
    expect([a, b, c]).toEqual(['tok-A', 'tok-A', 'tok-A']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clear() drops an IN-FLIGHT mint too, so the next call dials a fresh token (not the stale one)', async () => {
    // Gate the first mint on a deferred so it is still in flight when we call clear(). If clear()
    // reset only `cached`, the second getAccessToken would return the same in-flight (stale) promise.
    let releaseFirst!: (r: Response) => void;
    const firstMint = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? firstMint
        : jsonResponse(200, { access_token: 'tok-fresh', expires_in: 3600 });
    });
    const cache = createTokenCache(() => 0);

    // Start the first mint (still pending), then clear the cache before it resolves.
    const stalePromise = cache.getAccessToken(creds, fetchImpl as never);
    cache.clear();

    // A call after clear() must NOT reuse the in-flight stale mint - it dials a brand-new one.
    const freshToken = await cache.getAccessToken(creds, fetchImpl as never);
    expect(freshToken).toBe('tok-fresh');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Let the original (stale) mint resolve so no unhandled promise lingers.
    releaseFirst(jsonResponse(200, { access_token: 'tok-stale', expires_in: 3600 }));
    await expect(stalePromise).resolves.toBe('tok-stale');
  });
});

describe('addContactToList', () => {
  it('POSTs sign_up_form with a bearer token and the list membership', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, {});
    });
    await addContactToList(
      { accessToken: 'tok-A', email: 'a@b.com', listIds: ['l-1'] },
      fetchImpl as never,
    );
    expect(calls[0]!.url).toContain('api.cc.email/v3/contacts/sign_up_form');
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-A');
    const sent = JSON.parse(String(calls[0]!.init?.body));
    expect(sent.list_memberships).toEqual(['l-1']);
    expect(sent.create_source).toBe('Contact');
  });

  it('throws a status-carrying error on a non-2xx, without the response body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { email_address: 'ada@example.com' }));
    await expect(
      addContactToList({ accessToken: 't', email: 'a@b.com', listIds: ['l'] }, fetchImpl as never),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('submitSubscription self-heal', () => {
  it('reuses a live token, and on a 401 clears the cache, re-mints, and retries once', async () => {
    // Track the tokens minted and used so we can assert the self-heal path precisely.
    let tokenCounter = 0;
    const tokenFetch = vi.fn(async () =>
      jsonResponse(200, { access_token: `tok-${++tokenCounter}`, expires_in: 3600 }),
    );

    // The sign_up_form call: 401 on the FIRST attempt (stale token), 200 on the retry.
    const signupCalls: string[] = [];
    let signupAttempt = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/oauth2/')) {
        return tokenFetch();
      }
      // sign_up_form: capture the bearer token used, and fail the first attempt with a 401.
      const headers = (init?.headers ?? {}) as Record<string, string>;
      signupCalls.push(headers.Authorization ?? '');
      signupAttempt += 1;
      return jsonResponse(signupAttempt === 1 ? 401 : 200, {});
    });

    const cache = createTokenCache(() => 0);
    await submitSubscription(
      { email: 'a@b.com', clientId: 'c', refreshToken: 'r', listIds: ['l'] },
      { cache, fetchImpl: fetchImpl as never },
    );

    // Two sign_up_form attempts: the first with the stale token (tok-1), the retry with a fresh one
    // (tok-2) minted after `cache.clear()`.
    expect(signupCalls).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });

  it('a non-401 failure is not retried (it propagates)', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/oauth2/')) {
        return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
      }
      return jsonResponse(500, {});
    });
    const cache = createTokenCache(() => 0);
    await expect(
      submitSubscription(
        { email: 'a@b.com', clientId: 'c', refreshToken: 'r', listIds: ['l'] },
        { cache, fetchImpl: fetchImpl as never },
      ),
    ).rejects.toMatchObject({ status: 500 });
  });
});
