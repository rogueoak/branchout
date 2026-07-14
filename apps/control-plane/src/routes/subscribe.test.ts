import { describe, expect, it, vi } from 'vitest';
import type { PasswordHasher } from '../accounts/hasher';
import { InMemoryAccountRepository } from '../accounts/repository.memory';
import { AccountService } from '../accounts/service';
import { InMemoryAdminRepository } from '../admin/repository.memory';
import { AdminService } from '../admin/service';
import { InMemoryAdminSessionStore } from '../admin/session.store.memory';
import { createApp } from '../app';
import type {
  AdminCookieConfig,
  RateLimitConfig,
  SessionCookieConfig,
  SubscribeConfig,
} from '../config';
import { CreditLedger } from '../credits/ledger';
import { InMemoryLedgerRepository } from '../credits/repository.memory';
import { FreeTierProvider } from '../credits/tiers';
import { InMemoryPlaysRepository } from '../profiles/plays.memory';
import { ProfileService } from '../profiles/service';
import { InMemoryRateLimiter } from '../ratelimit/limiter.memory';
import { FakeEngineClient } from '../rooms/engine-client.fake';
import { InMemoryMembershipStore } from '../rooms/membership.memory';
import { InMemoryRoomRepository } from '../rooms/repository.memory';
import { RoomService } from '../rooms/service';
import { InMemorySessionStore } from '../sessions/store.memory';

const fakeHasher: PasswordHasher = {
  hash: async (plain) => `hashed:${plain}`,
  verify: async (stored, plain) => stored === `hashed:${plain}`,
};

const cookieConfig: SessionCookieConfig = {
  name: 'branchout_session',
  secure: true,
  sameSite: 'lax',
  ttlSeconds: 3600,
};
const adminCookieConfig: AdminCookieConfig = {
  name: 'branchout_admin_session',
  secure: true,
  sameSite: 'lax',
  ttlSeconds: 3600,
};
const rateLimit: RateLimitConfig = {
  loginMaxAttempts: 5,
  loginWindowSeconds: 900,
  signupMaxPerIp: 50,
  signupWindowSeconds: 3600,
};

/** All CTCT secrets set - the endpoint is live and will call the (mocked) CTCT fetch. */
const configuredSubscribe: SubscribeConfig = {
  ctctClientId: 'client-1',
  ctctRefreshToken: 'refresh-1',
  ctctListId: 'list-branch-out',
  maxPerIp: 5,
  windowSeconds: 600,
};

/** A `Response`-like stub for the injected CTCT fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A fetch that mints a token then 200s the sign_up_form, recording every call for assertions. */
function happyCtctFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/oauth2/')) {
      return jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 });
    }
    return jsonResponse(200, {});
  });
  return { fetchImpl, calls };
}

function makeApp(opts: { subscribe: SubscribeConfig; subscribeFetch?: typeof fetch }) {
  const repo = new InMemoryAccountRepository();
  const accounts = new AccountService(repo, fakeHasher);
  const sessions = new InMemorySessionStore(3600_000);
  const ledger = new CreditLedger(new InMemoryLedgerRepository(), new FreeTierProvider());
  const plays = new InMemoryPlaysRepository();
  const rooms = new RoomService(
    new InMemoryRoomRepository(),
    new InMemoryMembershipStore(),
    ledger,
    new FakeEngineClient(),
    plays,
    repo,
  );
  const profiles = new ProfileService(accounts, plays);
  const app = createApp({
    checks: { checkPostgres: async () => true, checkRedis: async () => true },
    accounts,
    profiles,
    sessions,
    rooms,
    cookie: cookieConfig,
    admins: new AdminService(new InMemoryAdminRepository(), fakeHasher),
    adminSessions: new InMemoryAdminSessionStore(3600_000),
    adminCookie: adminCookieConfig,
    webOrigins: ['http://localhost:3000'],
    limiter: new InMemoryRateLimiter(),
    rateLimit,
    subscribe: opts.subscribe,
    ...(opts.subscribeFetch ? { subscribeFetch: opts.subscribeFetch } : {}),
  });
  return app;
}

describe('POST /v1/subscribe (spec 0047)', () => {
  it('subscribes a valid email: posts a sign_up_form with the configured list id + create_source Contact', async () => {
    const { fetchImpl, calls } = happyCtctFetch();
    const app = makeApp({ subscribe: configuredSubscribe, subscribeFetch: fetchImpl as never });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { email: 'Ada@Example.com', name: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const signup = calls.find((c) => c.url.includes('sign_up_form'));
    expect(signup).toBeTruthy();
    const sent = JSON.parse(String(signup!.init!.body));
    expect(sent.list_memberships).toEqual(['list-branch-out']);
    expect(sent.create_source).toBe('Contact');
    expect(sent.email_address).toBe('ada@example.com');
    expect(sent.first_name).toBe('Ada');
    expect(sent.last_name).toBe('Lovelace');
    await app.close();
  });

  it('rejects an invalid email with 400 and makes NO CTCT call', async () => {
    const { fetchImpl } = happyCtctFetch();
    const app = makeApp({ subscribe: configuredSubscribe, subscribeFetch: fetchImpl as never });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('silently accepts a filled honeypot and makes NO CTCT call', async () => {
    const { fetchImpl } = happyCtctFetch();
    const app = makeApp({ subscribe: configuredSubscribe, subscribeFetch: fetchImpl as never });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { email: 'a@b.com', company: 'AcmeBot' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns the inert "not configured" 503 when a CTCT secret is unset', async () => {
    const { fetchImpl } = happyCtctFetch();
    const app = makeApp({
      // No ctct* keys -> inert.
      subscribe: { maxPerIp: 5, windowSeconds: 600 },
      subscribeFetch: fetchImpl as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { email: 'a@b.com' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'Subscribe is not configured yet.' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('rate limits per IP with a 429 once the cap is hit', async () => {
    const { fetchImpl } = happyCtctFetch();
    const app = makeApp({
      subscribe: { ...configuredSubscribe, maxPerIp: 2 },
      subscribeFetch: fetchImpl as never,
    });
    const sub = () =>
      app.inject({ method: 'POST', url: '/v1/subscribe', payload: { email: 'a@b.com' } });
    expect((await sub()).statusCode).toBe(200);
    expect((await sub()).statusCode).toBe(200);
    const capped = await sub();
    expect(capped.statusCode).toBe(429);
    expect(Number(capped.headers['retry-after'])).toBeGreaterThan(0);
    await app.close();
  });

  it('returns a generic 502 (never the CTCT body) when the upstream write fails', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/oauth2/')) {
        return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
      }
      // A 4xx whose body echoes the email - must NOT surface to the client.
      return jsonResponse(400, { email_address: 'ada@example.com', error: 'bad' });
    });
    const app = makeApp({ subscribe: configuredSubscribe, subscribeFetch: fetchImpl as never });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { email: 'ada@example.com' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('ada@example.com');
    await app.close();
  });
});
