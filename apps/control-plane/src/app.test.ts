import { describe, expect, it } from 'vitest';
import { ENGINE_ROUNDS_SUBPATH, V1_PREFIX } from '@branchout/protocol';
import type { PasswordHasher } from './accounts/hasher';
import { InMemoryAccountRepository } from './accounts/repository.memory';
import { AccountService } from './accounts/service';
import { InMemoryAdminRepository } from './admin/repository.memory';
import { AdminService } from './admin/service';
import { InMemoryAdminSessionStore } from './admin/session.store.memory';
import { createApp } from './app';
import type {
  AdminCookieConfig,
  FeedbackRateLimitConfig,
  SessionCookieConfig,
  SubscribeConfig,
} from './config';
import type { FeedbackEmail, FeedbackMailer } from './feedback/mailer';
import { ResendMailer } from './feedback/mailer';
import { CreditLedger } from './credits/ledger';
import { InMemoryLedgerRepository } from './credits/repository.memory';
import { FreeTierProvider } from './credits/tiers';
import { InMemoryPlaysRepository } from './profiles/plays.memory';
import { ProfileService } from './profiles/service';
import type { RateLimitConfig } from './config';
import { InMemoryRateLimiter } from './ratelimit/limiter.memory';
import { FakeEngineClient } from './rooms/engine-client.fake';
import { InMemoryMembershipStore } from './rooms/membership.memory';
import { InMemoryRoomRepository } from './rooms/repository.memory';
import { RoomService } from './rooms/service';
import { InMemorySessionStore } from './sessions/store.memory';

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

/** Generous defaults so the non-rate-limit tests never trip; individual tests override as needed. */
const defaultRateLimit: RateLimitConfig = {
  loginMaxAttempts: 5,
  loginWindowSeconds: 900,
  signupMaxPerIp: 50,
  signupWindowSeconds: 3600,
};

/** Generous feedback cap so the non-feedback tests never trip it. */
const defaultFeedbackRateLimit: FeedbackRateLimitConfig = { maxPerIp: 50, windowSeconds: 600 };

/** Subscribe config with no CTCT secrets (the endpoint is inert); generous per-IP cap. Spec 0047. */
const defaultSubscribe: SubscribeConfig = { maxPerIp: 50, windowSeconds: 600 };

interface MakeAppOptions {
  /** A feedback mailer to wire; omit to simulate an unset RESEND_API_KEY (the "not configured" case). */
  feedbackMailer?: FeedbackMailer;
  /** Override the feedback per-IP cap for a rate-limit test. */
  feedbackRateLimit?: FeedbackRateLimitConfig;
}

function makeApp(
  rateLimit: RateLimitConfig = defaultRateLimit,
  now?: () => number,
  options: MakeAppOptions = {},
) {
  const feedbackRateLimit = options.feedbackRateLimit ?? defaultFeedbackRateLimit;
  const feedbackMailer = options.feedbackMailer;
  const repo = new InMemoryAccountRepository();
  const accounts = new AccountService(repo, fakeHasher);
  const sessions = new InMemorySessionStore(3600_000);
  // `now` lets a test drive the limiter's clock to lapse a window without waiting.
  const limiter = new InMemoryRateLimiter(now);
  const ledger = new CreditLedger(new InMemoryLedgerRepository(), new FreeTierProvider());
  const engine = new FakeEngineClient();
  const plays = new InMemoryPlaysRepository();
  const membership = new InMemoryMembershipStore();
  const rooms = new RoomService(
    new InMemoryRoomRepository(),
    membership,
    ledger,
    engine,
    plays,
    repo,
  );
  const profiles = new ProfileService(accounts, plays);
  const adminRepo = new InMemoryAdminRepository();
  const admins = new AdminService(adminRepo, fakeHasher);
  const adminSessions = new InMemoryAdminSessionStore(3600_000);
  const app = createApp({
    checks: { checkPostgres: async () => true, checkRedis: async () => true },
    accounts,
    profiles,
    sessions,
    rooms,
    cookie: cookieConfig,
    admins,
    adminSessions,
    adminCookie: adminCookieConfig,
    webOrigins: ['http://localhost:3000'],
    limiter,
    rateLimit,
    ...(feedbackMailer ? { feedbackMailer } : {}),
    feedbackRateLimit,
    subscribe: defaultSubscribe,
  });
  return {
    app,
    accounts,
    sessions,
    repo,
    engine,
    plays,
    ledger,
    limiter,
    admins,
    adminSessions,
    adminRepo,
    rooms,
    membership,
  };
}

/** Pull the session cookie value out of a response's set-cookie header. */
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = header.match(/branchout_session=([^;]+)/);
  return match ? `branchout_session=${match[1]}` : '';
}

const validSignup = { email: 'player@example.com', password: 'supersecret', gamerTag: 'CoolCat' };

describe('control-plane /health', () => {
  it('returns ok when Postgres and Redis are reachable', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', postgres: 'ok', redis: 'ok' });
    await app.close();
  });
});

describe('API versioning (spec 0033)', () => {
  it('serves functional APIs under /v1 and 404s the un-versioned path', async () => {
    const { app } = makeApp();
    // The versioned path exists (unauthenticated /me reports "unauthenticated", a 200).
    const versioned = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(versioned.statusCode).toBe(200);
    // The bare path no longer resolves - the move is a real relocation, not an additive alias.
    const bare = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(bare.statusCode).toBe(404);
    await app.close();
  });

  it('keeps /health un-versioned (there is no /v1/health)', async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /auth/signup', () => {
  it('creates an account, sets an httpOnly secure sameSite cookie, and opens a session', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    expect(res.statusCode).toBe(201);
    expect(res.json().account).toMatchObject({ gamerTag: 'CoolCat', nickname: 'CoolCat' });

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('branchout_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    // The session works: /me reports the account.
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: sessionCookie(res) },
    });
    expect(me.json()).toMatchObject({ kind: 'account', account: { gamerTag: 'CoolCat' } });
    await app.close();
  });

  it('rejects a duplicate email with 409', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { ...validSignup, gamerTag: 'Other' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().field).toBe('email');
    await app.close();
  });

  it('rejects a duplicate gamer tag (case-insensitive) with 409', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'other@example.com', password: 'supersecret', gamerTag: 'coolcat' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().field).toBe('gamerTag');
    await app.close();
  });

  it('rejects invalid input with 400', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'bad', password: 'short', gamerTag: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /auth/login', () => {
  it('opens a session for correct credentials', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'player@example.com', password: 'supersecret' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('branchout_session=');
    await app.close();
  });

  it('returns 401 with a generic message for a wrong password', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'player@example.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid email or password.');
    expect(res.json().field).toBeUndefined();
    await app.close();
  });

  it('returns the same 401 for an unknown email (no field leak)', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ghost@example.com', password: 'supersecret' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid email or password.');
    await app.close();
  });
});

describe('DELETE /auth/account - self soft-delete (spec 0040)', () => {
  it('signs the caller out, blocks re-login, and frees the email + gamer tag for reuse', async () => {
    const { app } = makeApp();
    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const cookie = sessionCookie(signup);

    const del = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/account',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    // The session cookie is cleared, and the (now revoked) session reads as unauthenticated.
    expect(String(del.headers['set-cookie'])).toContain('branchout_session=;');
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().kind).toBe('unauthenticated');

    // The deleted account cannot log back in...
    const relogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: validSignup.email, password: validSignup.password },
    });
    expect(relogin.statusCode).toBe(401);

    // ...but the same email + gamer tag can register a fresh account (freed for reuse).
    const again = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    expect(again.statusCode).toBe(201);
    await app.close();
  });

  it('requires an account session (an anonymous / signed-out caller is refused)', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/auth/account' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('auth rate limiting (spec 0036)', () => {
  const creds = { email: 'player@example.com', password: 'supersecret' };
  const wrong = { email: 'player@example.com', password: 'nope' };

  it('locks a sign-in out after the attempt limit, with a Retry-After and a uniform message', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });

    // Five wrong passwords all still return the normal 401 (under the limit of 5).
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
      expect(res.statusCode).toBe(401);
    }
    // The sixth is locked out - a 429 that reveals nothing (same wording regardless of the account).
    const blocked = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json().error).toBe('Too many attempts. Please try again later.');
    // Even the CORRECT password is refused while locked (the check runs before verifying).
    const stillBlocked = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: creds,
    });
    expect(stillBlocked.statusCode).toBe(429);
    await app.close();
  });

  it('a successful sign-in clears the counter (earlier typos do not accumulate)', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });

    for (let i = 0; i < 4; i++) {
      await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
    }
    // A correct login is allowed (still under the limit) and resets the failure counter.
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: creds });
    expect(ok.statusCode).toBe(200);
    // After the reset, four fresh misses are back to 401 (not immediately locked from before).
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('anchors the lockout on the account, not the client IP (a forgeable IP cannot evade it)', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });

    // Lock the account with six wrong passwords, each from a DIFFERENT forged X-Forwarded-For.
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: wrong,
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
      });
    }
    // A brand-new forged IP is STILL locked - rotating XFF does not mint a fresh bucket, because the
    // key is the account, not the account+IP.
    const rotatedIp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: wrong,
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(rotatedIp.statusCode).toBe(429);
    await app.close();
  });

  it('keys the lockout per account (a different account is unaffected)', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'other@example.com', password: 'supersecret', gamerTag: 'Other' },
    });

    for (let i = 0; i < 6; i++) {
      await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
    }
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong })).statusCode,
    ).toBe(429);
    // A different account has its own counter - a normal 401, not locked.
    const otherAccount = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'other@example.com', password: 'nope' },
    });
    expect(otherAccount.statusCode).toBe(401);
    await app.close();
  });

  it('releases the lock once the window elapses', async () => {
    let clock = 1_000_000;
    const { app } = makeApp(defaultRateLimit, () => clock);
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });

    for (let i = 0; i < 6; i++) {
      await app.inject({ method: 'POST', url: '/v1/auth/login', payload: wrong });
    }
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: creds })).statusCode,
    ).toBe(429);
    // Advance past the window: the counter lapses, so the correct password is accepted again.
    clock += (defaultRateLimit.loginWindowSeconds + 1) * 1000;
    const afterWindow = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: creds });
    expect(afterWindow.statusCode).toBe(200);
    await app.close();
  });

  it('caps sign-ups per IP with a 429 once the cap is hit', async () => {
    const { app } = makeApp({ ...defaultRateLimit, signupMaxPerIp: 2 });
    const at = (n: number) => ({
      email: `p${n}@example.com`,
      password: 'supersecret',
      gamerTag: `Player${n}`,
    });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(1) })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(2) })).statusCode,
    ).toBe(201);
    const capped = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(3) });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toBe('Too many attempts. Please try again later.');
    await app.close();
  });

  it('caps sign-ups per IP independently (one IP capped, another still allowed)', async () => {
    const { app } = makeApp({ ...defaultRateLimit, signupMaxPerIp: 1 });
    const at = (n: number) => ({
      email: `p${n}@example.com`,
      password: 'supersecret',
      gamerTag: `Player${n}`,
    });
    const ip1 = { 'x-forwarded-for': '10.0.0.1' };
    const ip2 = { 'x-forwarded-for': '10.0.0.2' };
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(1), headers: ip1 }))
        .statusCode,
    ).toBe(201);
    // IP1 is capped...
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(2), headers: ip1 }))
        .statusCode,
    ).toBe(429);
    // ...but IP2 has its own bucket.
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: at(3), headers: ip2 }))
        .statusCode,
    ).toBe(201);
    await app.close();
  });

  it('counts a rejected sign-up against the cap (a failed attempt still consumes a slot)', async () => {
    const { app } = makeApp({ ...defaultRateLimit, signupMaxPerIp: 2 });
    // First a real account, then a duplicate that 409s - which still counts - so the third is capped.
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup }))
        .statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup }))
        .statusCode,
    ).toBe(409);
    const third = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'fresh@example.com', password: 'supersecret', gamerTag: 'Fresh' },
    });
    expect(third.statusCode).toBe(429);
    await app.close();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { app } = makeApp();
    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const cookie = sessionCookie(signup);

    const out = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('branchout_session=;');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json()).toEqual({ kind: 'unauthenticated' });
    await app.close();
  });

  it('is idempotent with no session cookie', async () => {
    const { app } = makeApp();
    const out = await app.inject({ method: 'POST', url: '/v1/auth/logout' });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('branchout_session=;');
    await app.close();
  });
});

describe('GET /auth/me', () => {
  it('reports unauthenticated with no cookie', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(res.json()).toEqual({ kind: 'unauthenticated' });
    await app.close();
  });

  it('reports the display name for an anonymous session', async () => {
    const { app } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest Gonzo' },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: sessionCookie(join) },
    });
    expect(me.json()).toEqual({ kind: 'anonymous', displayName: 'Guest Gonzo' });
    await app.close();
  });

  it('treats a session whose account row is gone as logged out and self-revokes it', async () => {
    const { app, repo } = makeApp();
    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const cookie = sessionCookie(signup);
    // Drop the underlying account, leaving a dangling account session.
    repo.deleteById(signup.json().account.id);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json()).toEqual({ kind: 'unauthenticated' });
    expect(String(me.headers['set-cookie'])).toContain('branchout_session=;');
    await app.close();
  });
});

describe('POST /auth/anonymous', () => {
  it('mints an anonymous session with a display name and no account row', async () => {
    const { app, accounts } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest Gonzo' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ kind: 'anonymous', displayName: 'Guest Gonzo' });
    // No account was created for an anonymous join.
    expect(await accounts.login({ email: 'guest gonzo', password: 'x' })).toBeNull();
    await app.close();
  });

  it('an anonymous session cannot host: it is not an account session', async () => {
    const { app, sessions } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest' },
    });
    const cookieValue = sessionCookie(join).split('=')[1]!;
    const session = await sessions.read(cookieValue);
    expect(session?.kind).toBe('anonymous');
    expect(session?.accountId).toBeUndefined();
    await app.close();
  });

  it('requires a room code and a valid display name', async () => {
    const { app } = makeApp();
    const noCode = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { displayName: 'Guest' },
    });
    expect(noCode.statusCode).toBe(400);
    const noName = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: '' },
    });
    expect(noName.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /auth/nickname', () => {
  it('changes the nickname for an account session', async () => {
    const { app } = makeApp();
    const signup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const cookie = sessionCookie(signup);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/nickname',
      headers: { cookie },
      payload: { nickname: 'The Great Gonzo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.nickname).toBe('The Great Gonzo');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().account.nickname).toBe('The Great Gonzo');
    await app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/nickname',
      payload: { nickname: 'Nope' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an anonymous session with 401 (accounts only)', async () => {
    const { app } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/nickname',
      headers: { cookie: sessionCookie(join) },
      payload: { nickname: 'Nope' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

/** Sign up and return the app plus the host's session cookie. */
async function withHost(app: ReturnType<typeof makeApp>['app']) {
  const signup = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
  return sessionCookie(signup);
}

describe('POST /rooms (create + share link)', () => {
  it('a signed-in host creates a room with a 5-char code and a /join share link', async () => {
    const { app } = makeApp();
    const cookie = await withHost(app);
    const res = await app.inject({ method: 'POST', url: '/v1/rooms', headers: { cookie } });
    expect(res.statusCode).toBe(201);
    const { room, playerId } = res.json();
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.shareLink).toBe(`/join?code=${room.code}`);
    // Create echoes the host's public playerId (its engine identity), like join does.
    expect(typeof playerId).toBe('string');
    expect(playerId.length).toBeGreaterThan(0);
    await app.close();
  });

  it('an unauthenticated request cannot create a room', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/v1/rooms' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('an anonymous session cannot host (403)', async () => {
    const { app } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: sessionCookie(join) },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /rooms/:code/me - returning host resume (feedback 0021)', () => {
  it('re-seats a durable host whose roster row expired, instead of bouncing them to join', async () => {
    const { app, membership } = makeApp();
    const hostCookie = await withHost(app);
    const hostSessionId = hostCookie.replace('branchout_session=', '');
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { room } = create.json();

    // Simulate the Redis membership TTL evicting the host's roster row (host_account_id in Postgres
    // still names them the host).
    await membership.remove(room.id, hostSessionId);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/rooms/${room.code}/me`,
      headers: { cookie: hostCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.room.code).toBe(room.code);
    expect(body.membership).toMatchObject({ mode: 'interactive', isHost: true });
    expect(typeof body.membership.player).toBe('string');
    await app.close();
  });

  it('404s a stranger who is not a member (the client shows the join prompt)', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { room } = create.json();

    const strangerSignup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'stranger@example.com', password: 'supersecret', gamerTag: 'Stranger' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/rooms/${room.code}/me`,
      headers: { cookie: sessionCookie(strangerSignup) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_member');
    await app.close();
  });

  it('401s a request with no session', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { room } = create.json();
    const res = await app.inject({ method: 'GET', url: `/v1/rooms/${room.code}/me` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /rooms/:code/preview (public, for link unfurls)', () => {
  it('serves status and selected game with no session (a crawler is not a member)', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { code } = create.json().room;
    await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/select`,
      headers: { cookie: hostCookie },
      payload: { game: 'trivia', config: {} },
    });

    // No cookie header at all - the public unfurl path.
    const res = await app.inject({ method: 'GET', url: `/v1/rooms/${code}/preview` });
    expect(res.statusCode).toBe(200);
    expect(res.json().preview).toEqual({ code, status: 'lobby', selectedGame: 'trivia' });
    // No private fields leak through the route.
    const body = JSON.stringify(res.json());
    expect(body).not.toContain('hostAccountId');
    expect(body).not.toContain('sessionId');
    await app.close();
  });

  it('404s an unknown code', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/v1/rooms/ZZZZZ/preview' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /rooms/:code/join and kick over HTTP', () => {
  it('a joiner picks a per-game nickname and appears in the members list', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { code } = create.json().room;

    const guestJoin = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code, displayName: 'GuestName' },
    });
    const guestCookie = sessionCookie(guestJoin);
    const joined = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/join`,
      headers: { cookie: guestCookie },
      payload: { nickname: 'ArcadeAce', mode: 'interactive' },
    });
    expect(joined.statusCode).toBe(200);

    // Join returns the caller's own public playerId (its engine identity), never the session id.
    expect(typeof joined.json().playerId).toBe('string');
    expect(joined.json().playerId.length).toBeGreaterThan(0);
    expect(JSON.stringify(joined.json())).not.toContain(guestCookie.split('=')[1]!);

    const members = await app.inject({
      method: 'GET',
      url: `/v1/rooms/${code}/members`,
      headers: { cookie: hostCookie },
    });
    const names = members.json().members.map((m: { nickname: string }) => m.nickname);
    expect(names).toContain('ArcadeAce');
    await app.close();
  });

  it('never returns a session id to a non-host, but does give them a playerId', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { code } = create.json().room;

    const guestJoin = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code, displayName: 'Watcher' },
    });
    const guestCookie = sessionCookie(guestJoin);
    await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/join`,
      headers: { cookie: guestCookie },
      payload: { nickname: 'Watcher', mode: 'viewer' },
    });

    // The non-host's own members view redacts every sessionId but keeps the public playerId.
    const members = await app.inject({
      method: 'GET',
      url: `/v1/rooms/${code}/members`,
      headers: { cookie: guestCookie },
    });
    const rows = members.json().members as Array<{ sessionId?: string; playerId?: string }>;
    expect(rows.every((m) => m.sessionId === undefined)).toBe(true);
    expect(rows.every((m) => typeof m.playerId === 'string' && m.playerId.length > 0)).toBe(true);
    await app.close();
  });

  it('the host kicks a member and that session can no longer rejoin', async () => {
    const { app } = makeApp();
    const hostCookie = await withHost(app);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { code } = create.json().room;

    const guestJoin = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: { code, displayName: 'Victim' },
    });
    const guestCookie = sessionCookie(guestJoin);
    await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/join`,
      headers: { cookie: guestCookie },
      payload: { nickname: 'Victim', mode: 'interactive' },
    });
    const guestSessionId = guestCookie.split('=')[1]!;

    const kick = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/kick`,
      headers: { cookie: hostCookie },
      payload: { sessionId: guestSessionId },
    });
    expect(kick.statusCode).toBe(200);

    const rejoin = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/join`,
      headers: { cookie: guestCookie },
      payload: { nickname: 'Victim', mode: 'interactive' },
    });
    expect(rejoin.statusCode).toBe(403);
    expect(rejoin.json().code).toBe('kicked');
    await app.close();
  });
});

describe('POST /rooms/:code/control allow-list', () => {
  async function hostedRoomWithGame() {
    const ctx = makeApp();
    const hostCookie = await withHost(ctx.app);
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: { cookie: hostCookie },
    });
    const { code } = create.json().room;
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/select`,
      headers: { cookie: hostCookie },
      payload: { game: 'trivia', config: { questions: 3 } },
    });
    return { ...ctx, hostCookie, code };
  }

  it('accepts advance and forwards it to the engine', async () => {
    const { app, engine, hostCookie, code } = await hostedRoomWithGame();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/control`,
      headers: { cookie: hostCookie },
      payload: { action: 'advance' },
    });
    expect(res.statusCode).toBe(200);
    expect(engine.controls.map((c) => c.action)).toContain('advance');
    await app.close();
  });

  it('rejects an unknown action with 400 and no engine call', async () => {
    const { app, engine, hostCookie, code } = await hostedRoomWithGame();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${code}/control`,
      headers: { cookie: hostCookie },
      payload: { action: 'nuke' },
    });
    expect(res.statusCode).toBe(400);
    expect(engine.controls).toHaveLength(0);
    await app.close();
  });
});

describe('engine report intake (internal token)', () => {
  it('rejects a report without the internal token when one is configured', async () => {
    const { app } = makeAppWithToken('s3cret');
    const res = await app.inject({
      method: 'POST',
      url: `${V1_PREFIX}${ENGINE_ROUNDS_SUBPATH}`,
      payload: {
        v: 1,
        room: 'r',
        game: 'trivia',
        round: 1,
        roundId: 'x',
        scores: [],
        standings: [],
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a well-formed report with the token and rejects a malformed body with 400', async () => {
    const { app } = makeAppWithToken('s3cret');
    const bad = await app.inject({
      method: 'POST',
      url: `${V1_PREFIX}${ENGINE_ROUNDS_SUBPATH}`,
      headers: { 'x-internal-token': 's3cret' },
      payload: { v: 1 },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

/** An app whose engine intake is guarded by a shared internal token. */
function makeAppWithToken(token: string) {
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
    internalToken: token,
    limiter: new InMemoryRateLimiter(),
    rateLimit: defaultRateLimit,
    feedbackRateLimit: defaultFeedbackRateLimit,
    subscribe: defaultSubscribe,
  });
  return { app };
}

describe('profile endpoints (spec 0027)', () => {
  /** Sign up and return the session cookie for authenticated PATCH calls. */
  async function signedIn(app: ReturnType<typeof makeApp>['app']) {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    return sessionCookie(res);
  }

  it('PATCH /v1/auth/avatar updates the avatar and /me reflects it; rejects anon and unknown id', async () => {
    const { app } = makeApp();
    const cookie = await signedIn(app);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/avatar',
      headers: { cookie },
      payload: { avatar: 'frog' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().account.avatar).toBe('frog');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().account).toMatchObject({ avatar: 'frog', visibility: 'public' });

    // Unknown avatar id -> 400.
    const bad = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/avatar',
      headers: { cookie },
      payload: { avatar: 'not-real' },
    });
    expect(bad.statusCode).toBe(400);

    // No session -> 401.
    const anon = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/avatar',
      payload: { avatar: 'frog' },
    });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it('PATCH /v1/auth/visibility updates visibility; rejects anon and invalid value', async () => {
    const { app } = makeApp();
    const cookie = await signedIn(app);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/visibility',
      headers: { cookie },
      payload: { visibility: 'private' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().account.visibility).toBe('private');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/visibility',
      headers: { cookie },
      payload: { visibility: 'everyone' },
    });
    expect(bad.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/visibility',
      payload: { visibility: 'private' },
    });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it('GET /v1/profiles/:gamerTag returns a public profile, 404s an unknown tag, and leaks no PII', async () => {
    const { app } = makeApp();
    await signedIn(app); // creates gamerTag "CoolCat", email player@example.com

    const res = await app.inject({ method: 'GET', url: '/v1/profiles/CoolCat' });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toMatchObject({
      gamerTag: 'CoolCat',
      totalStars: 0,
      visibility: 'public',
      restricted: false,
    });
    // Never leaks the email or an account id.
    const body = res.body;
    expect(body).not.toContain(validSignup.email);
    expect(body).not.toContain('acct_');

    const missing = await app.inject({ method: 'GET', url: '/v1/profiles/ghost' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('a private profile over /v1/profiles hides the detail (restricted)', async () => {
    const { app } = makeApp();
    const cookie = await signedIn(app);
    await app.inject({
      method: 'PATCH',
      url: '/v1/auth/visibility',
      headers: { cookie },
      payload: { visibility: 'private' },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/profiles/CoolCat' });
    expect(res.json().profile).toEqual({
      gamerTag: 'CoolCat',
      totalStars: 0,
      visibility: 'private',
      restricted: true,
    });
    await app.close();
  });
});

/** Pull the admin session cookie value out of a response's set-cookie header. */
function adminCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = header.match(/branchout_admin_session=([^;]+)/);
  return match ? `branchout_admin_session=${match[1]}` : '';
}

const rootAdmin = { email: 'root@rogueoak.com', password: 'super-strong-admin-pw' };

describe('admin console API (spec 0037)', () => {
  /** Seed the root admin and return an authenticated admin cookie. */
  async function asRootAdmin(t: ReturnType<typeof makeApp>) {
    await t.admins.ensureRootAdmin(rootAdmin.email, rootAdmin.password);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: rootAdmin,
    });
    expect(res.statusCode).toBe(200);
    return adminCookie(res);
  }

  it('logs a seeded root admin in and sets a host-only admin cookie', async () => {
    const t = makeApp();
    await t.admins.ensureRootAdmin(rootAdmin.email, rootAdmin.password);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: rootAdmin,
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('branchout_admin_session=');
    expect(setCookie).toContain('HttpOnly');
    // Host-only: the admin cookie must never carry a Domain (never spans the apex/subdomains).
    expect(setCookie.toLowerCase()).not.toContain('domain=');
    await t.app.close();
  });

  it('rejects a wrong admin password and locks after the limit', async () => {
    const t = makeApp({ ...defaultRateLimit, loginMaxAttempts: 3 });
    await t.admins.ensureRootAdmin(rootAdmin.email, rootAdmin.password);
    for (let i = 0; i < 3; i++) {
      const bad = await t.app.inject({
        method: 'POST',
        url: '/v1/admin/auth/login',
        payload: { email: rootAdmin.email, password: 'wrong' },
      });
      expect(bad.statusCode).toBe(401);
    }
    const locked = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email: rootAdmin.email, password: 'wrong' },
    });
    expect(locked.statusCode).toBe(429);
    await t.app.close();
  });

  it('refuses admin routes without a valid admin session', async () => {
    const t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/v1/admin/users' });
    expect(res.statusCode).toBe(401);
    await t.app.close();
  });

  it('a player session grants no admin access', async () => {
    const t = makeApp();
    const signup = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const playerCookie = sessionCookie(signup);
    // The player cookie is a different cookie name; the admin gate ignores it -> 401.
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { cookie: playerCookie },
    });
    expect(res.statusCode).toBe(401);
    await t.app.close();
  });

  it('an admin creates another admin who can then log in', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/admins',
      headers: { cookie },
      payload: { email: 'ops@rogueoak.com', password: 'another-strong-admin-pw' },
    });
    expect(created.statusCode).toBe(201);
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      payload: { email: 'ops@rogueoak.com', password: 'another-strong-admin-pw' },
    });
    expect(login.statusCode).toBe(200);
    await t.app.close();
  });

  it('lists players by gamer tag and toggles a user insider', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    // Create a player to manage.
    await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });

    const list = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=cool',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      items: Array<{ id: string; gamerTag: string; insider: boolean }>;
    };
    const player = body.items.find((u) => u.gamerTag === 'CoolCat');
    expect(player).toBeTruthy();
    expect(player!.insider).toBe(false);

    const grant = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player!.id}/insider`,
      headers: { cookie },
      payload: { insider: true },
    });
    expect(grant.statusCode).toBe(200);
    expect((grant.json() as { account: { insider: boolean } }).account.insider).toBe(true);
    await t.app.close();
  });

  it('hard-deletes a player (spec 0040): the row is gone and the user leaves the list', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const list1 = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=cool',
      headers: { cookie },
    });
    const player = (list1.json() as { items: Array<{ id: string; gamerTag: string }> }).items.find(
      (u) => u.gamerTag === 'CoolCat',
    );
    expect(player).toBeTruthy();

    // Seed a credit-ledger entry for the player. Hard delete must KEEP the ledger (audit) even as it
    // purges the account - that is the whole reason admin-delete is hard, not soft. (The sibling
    // guarantee, account_game_plays cascading away, is a Postgres FK `ON DELETE CASCADE` that the
    // in-memory harness does not model, so it is verified by the migration/schema, not asserted here.)
    await t.ledger.grantDaily(player!.id);
    const balanceBefore = await t.ledger.balance(player!.id);
    expect(balanceBefore).toBeGreaterThan(0);

    const del = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player!.id}/delete`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);

    // The ledger rows survive the purge - the balance is unchanged (a regression guard against the
    // service ever being changed to also delete the ledger).
    expect(await t.ledger.balance(player!.id)).toBe(balanceBefore);

    // The detail 404s and the list no longer shows the player - the row is truly gone.
    const detail = await t.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${player!.id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(404);
    const list2 = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=cool',
      headers: { cookie },
    });
    expect((list2.json() as { items: unknown[] }).items).toHaveLength(0);

    // A second delete is a 404 (nothing left to remove).
    const again = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player!.id}/delete`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(404);
    await t.app.close();
  });

  it('keeps a self-soft-deleted player visible to the admin, flagged deleted (spec 0040)', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    const signup = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const playerCookie = sessionCookie(signup);
    // The player deletes their own account.
    const del = await t.app.inject({
      method: 'DELETE',
      url: '/v1/auth/account',
      headers: { cookie: playerCookie },
    });
    expect(del.statusCode).toBe(200);

    // The admin still sees the row, now carrying deletedAt (the console flags it "Deleted"). Search
    // by the original tag no longer matches - soft-delete frees the normalized tag for reuse - so the
    // row is found by browsing the unfiltered list, where the preserved display gamer tag still shows.
    const list = await t.app.inject({ method: 'GET', url: '/v1/admin/users', headers: { cookie } });
    const player = (
      list.json() as { items: Array<{ gamerTag: string; deletedAt: string | null }> }
    ).items.find((u) => u.gamerTag === 'CoolCat');
    expect(player).toBeTruthy();
    expect(player!.deletedAt).toBeTruthy();
    await t.app.close();
  });

  it('gates every admin route against no session AND against a player session', async () => {
    const t = makeApp();
    const signup = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const playerCookie = sessionCookie(signup);
    const routes: Array<{ method: 'GET' | 'POST'; url: string }> = [
      { method: 'POST', url: '/v1/admin/admins' },
      { method: 'GET', url: '/v1/admin/admins' },
      { method: 'GET', url: '/v1/admin/users' },
      { method: 'GET', url: '/v1/admin/users/some-id' },
      { method: 'POST', url: '/v1/admin/users/some-id/insider' },
      { method: 'POST', url: '/v1/admin/users/some-id/delete' },
    ];
    for (const r of routes) {
      const anon = await t.app.inject({ method: r.method, url: r.url });
      expect(anon.statusCode, `${r.method} ${r.url} anon`).toBe(401);
      const player = await t.app.inject({
        method: r.method,
        url: r.url,
        headers: { cookie: playerCookie },
      });
      expect(player.statusCode, `${r.method} ${r.url} player`).toBe(401);
    }
    await t.app.close();
  });

  it('rejects a duplicate admin email with 409 and attributes createdBy', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    const me = await t.app.inject({ method: 'GET', url: '/v1/admin/auth/me', headers: { cookie } });
    const rootId = (me.json() as { admin: { id: string } }).admin.id;
    const payload = { email: 'ops@rogueoak.com', password: 'another-strong-admin-pw' };
    const first = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/admins',
      headers: { cookie },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect((first.json() as { admin: { createdBy: string } }).admin.createdBy).toBe(rootId);
    const dup = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/admins',
      headers: { cookie },
      payload: { ...payload, email: 'OPS@rogueoak.com' },
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { field: string }).field).toBe('email');
    await t.app.close();
  });

  it('returns pagination metadata and clamps a bad page to 1', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?page=0',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { page: number; pageSize: number; total: number };
    expect(body.page).toBe(1); // page=0 clamped to 1
    expect(body.pageSize).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(1);
    await t.app.close();
  });

  it('reflects an insider grant in the player /auth/me and revokes it', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    const signup = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: validSignup,
    });
    const playerCookie = sessionCookie(signup);
    const list = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=cool',
      headers: { cookie },
    });
    const player = (list.json() as { items: Array<{ id: string; gamerTag: string }> }).items.find(
      (u) => u.gamerTag === 'CoolCat',
    )!;

    await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player.id}/insider`,
      headers: { cookie },
      payload: { insider: true },
    });
    const afterGrant = await t.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: playerCookie },
    });
    expect((afterGrant.json() as { account: { insider: boolean } }).account.insider).toBe(true);

    const revoke = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player.id}/insider`,
      headers: { cookie },
      payload: { insider: false },
    });
    expect(revoke.statusCode).toBe(200);
    const afterRevoke = await t.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: playerCookie },
    });
    expect((afterRevoke.json() as { account: { insider: boolean } }).account.insider).toBe(false);
    await t.app.close();
  });

  it('rejects an insider toggle on a missing user (404) and a non-boolean body (400)', async () => {
    const t = makeApp();
    const cookie = await asRootAdmin(t);
    const missing = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/users/00000000-0000-0000-0000-000000000000/insider',
      headers: { cookie },
      payload: { insider: true },
    });
    expect(missing.statusCode).toBe(404);

    await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: validSignup });
    const list = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/users?query=cool',
      headers: { cookie },
    });
    const player = (list.json() as { items: Array<{ id: string; gamerTag: string }> }).items.find(
      (u) => u.gamerTag === 'CoolCat',
    )!;
    const bad = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/users/${player.id}/insider`,
      headers: { cookie },
      payload: { insider: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
    await t.app.close();
  });

  it('anchors the admin lockout on the account, not the IP (rotating XFF does not reset it)', async () => {
    const t = makeApp({ ...defaultRateLimit, loginMaxAttempts: 3 });
    await t.admins.ensureRootAdmin(rootAdmin.email, rootAdmin.password);
    for (let i = 0; i < 3; i++) {
      const bad = await t.app.inject({
        method: 'POST',
        url: '/v1/admin/auth/login',
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
        payload: { email: rootAdmin.email, password: 'wrong' },
      });
      expect(bad.statusCode).toBe(401);
    }
    // A brand-new source IP does NOT get a fresh bucket - the lock is keyed on the admin account.
    const locked = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      payload: { email: rootAdmin.email, password: 'wrong' },
    });
    expect(locked.statusCode).toBe(429);
    await t.app.close();
  });
});

/** A recording fake mailer: captures each send so a test can assert the from/to/body it produced. */
class RecordingMailer implements FeedbackMailer {
  readonly sent: FeedbackEmail[] = [];
  async send(email: FeedbackEmail): Promise<void> {
    this.sent.push(email);
  }
}

describe('control-plane POST /v1/feedback (spec 0048)', () => {
  /** Sign up a host and create a room; returns the host cookie and the room code for the context. */
  async function hostWithRoom(app: ReturnType<typeof makeApp>['app']) {
    const cookie = await withHost(app);
    const create = await app.inject({ method: 'POST', url: '/v1/rooms', headers: { cookie } });
    const { room } = create.json();
    return { cookie, code: room.code as string };
  }

  it('sends the message + context via the mailer when a key is configured', async () => {
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const { cookie, code } = await hostWithRoom(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie },
      payload: {
        message: 'The drop button is hard to reach on a phone.',
        context: {
          code,
          game: 'teeter-tower',
          phase: 'collecting',
          isHost: true,
          at: '2026-07-14T12:00:00.000Z',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    // The recipient is fixed and the body carries the message + every context field it needs to act.
    const sent = mailer.sent[0];
    if (!sent) throw new Error('expected a sent email');
    const { text } = sent;
    expect(text).toContain('The drop button is hard to reach on a phone.');
    expect(text).toContain(`room code: ${code}`);
    expect(text).toContain('game: teeter-tower');
    expect(text).toContain('phase: collecting');
    expect(text).toContain('host: yes');
    expect(text).toContain('submitted at: 2026-07-14T12:00:00.000Z');
    await app.close();
  });

  it('the mailer targets feedback@rogueoak.com from branchout@rogueoak.com', async () => {
    // Assert the from/to at the Resend REST boundary, not just the interface, so the addresses are
    // pinned where they actually go on the wire.
    const calls: Array<{ from: string; to: string; subject: string; text: string }> = [];
    const fakeFetch = (async (_url: string | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = new ResendMailer('re_test_key', fakeFetch);
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const { cookie, code } = await hostWithRoom(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie },
      payload: { message: 'Nice game.', context: { code } },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected a Resend request');
    expect(call.from).toBe('branchout@rogueoak.com');
    expect(call.to).toBe('feedback@rogueoak.com');
    expect(call.text).toContain('Nice game.');
    await app.close();
  });

  it('refuses an unauthenticated caller with 401 and never sends', async () => {
    // The endpoint spends money on Resend, so an anonymous internet caller must not reach it.
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      payload: { message: 'Hi', context: { code: 'ABC12' } },
    });
    expect(res.statusCode).toBe(401);
    expect(mailer.sent).toHaveLength(0);
    await app.close();
  });

  it('refuses a signed-in non-host of the named room with 403 and never sends', async () => {
    // A signed-in player who is not the host of the room in the context cannot send host feedback for
    // it - isHost is server-verified against the room, not trusted from the body.
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const { code } = await hostWithRoom(app);
    // A second account that is not a member of the host's room.
    const strangerSignup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'stranger@example.com', password: 'supersecret', gamerTag: 'Stranger' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie: sessionCookie(strangerSignup) },
      // A hostile body claiming isHost: true must not fool the server.
      payload: { message: 'let me in', context: { code, isHost: true } },
    });
    expect(res.statusCode).toBe(403);
    expect(mailer.sent).toHaveLength(0);
    await app.close();
  });

  it('rejects an empty message with 400 and never sends', async () => {
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const { cookie, code } = await hostWithRoom(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie },
      payload: { message: '   ', context: { code } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
    expect(mailer.sent).toHaveLength(0);
    await app.close();
  });

  it('rejects a message over the 5000-char cap with 400 and never sends', async () => {
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, { feedbackMailer: mailer });
    const { cookie, code } = await hostWithRoom(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie },
      payload: { message: 'x'.repeat(5001), context: { code } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
    expect(mailer.sent).toHaveLength(0);
    await app.close();
  });

  it('returns a clear "not configured" 503 when no mailer is wired (RESEND_API_KEY unset)', async () => {
    // No feedbackMailer -> the wire-the-secret-later state. It must not crash.
    const { app } = makeApp();
    const { cookie, code } = await hostWithRoom(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      headers: { cookie },
      payload: { message: 'Hi', context: { code } },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'Feedback email is not configured yet.' });
    await app.close();
  });

  it('caps the per-IP rate on every processed path, including the not-configured 503', async () => {
    // No mailer wired: the request is authenticated + processed (503) but must still count against
    // the cap, so the not-configured path cannot be hammered without limit.
    const { app } = makeApp(defaultRateLimit, undefined, {
      feedbackRateLimit: { maxPerIp: 2, windowSeconds: 600 },
    });
    const { cookie, code } = await hostWithRoom(app);
    const submit = () =>
      app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: { cookie, 'x-forwarded-for': '198.51.100.9' },
        payload: { message: 'again', context: { code } },
      });
    expect((await submit()).statusCode).toBe(503);
    expect((await submit()).statusCode).toBe(503);
    const blocked = await submit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('rate-limits per IP with a 429 + Retry-After', async () => {
    const mailer = new RecordingMailer();
    const { app } = makeApp(defaultRateLimit, undefined, {
      feedbackMailer: mailer,
      feedbackRateLimit: { maxPerIp: 2, windowSeconds: 600 },
    });
    const { cookie, code } = await hostWithRoom(app);
    const submit = () =>
      app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: { cookie, 'x-forwarded-for': '198.51.100.7' },
        payload: { message: 'again', context: { code } },
      });
    expect((await submit()).statusCode).toBe(200);
    expect((await submit()).statusCode).toBe(200);
    const blocked = await submit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // Only the two allowed submissions sent; the blocked one did not reach the mailer.
    expect(mailer.sent).toHaveLength(2);
    await app.close();
  });
});
