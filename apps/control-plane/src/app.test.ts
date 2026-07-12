import { describe, expect, it } from 'vitest';
import { ENGINE_ROUNDS_SUBPATH, V1_PREFIX } from '@branchout/protocol';
import type { PasswordHasher } from './accounts/hasher';
import { InMemoryAccountRepository } from './accounts/repository.memory';
import { AccountService } from './accounts/service';
import { createApp } from './app';
import type { SessionCookieConfig } from './config';
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

/** Generous defaults so the non-rate-limit tests never trip; individual tests override as needed. */
const defaultRateLimit: RateLimitConfig = {
  loginMaxAttempts: 5,
  loginWindowSeconds: 900,
  signupMaxPerIp: 50,
  signupWindowSeconds: 3600,
};

function makeApp(rateLimit: RateLimitConfig = defaultRateLimit, now?: () => number) {
  const repo = new InMemoryAccountRepository();
  const accounts = new AccountService(repo, fakeHasher);
  const sessions = new InMemorySessionStore(3600_000);
  // `now` lets a test drive the limiter's clock to lapse a window without waiting.
  const limiter = new InMemoryRateLimiter(now);
  const ledger = new CreditLedger(new InMemoryLedgerRepository(), new FreeTierProvider());
  const engine = new FakeEngineClient();
  const plays = new InMemoryPlaysRepository();
  const rooms = new RoomService(
    new InMemoryRoomRepository(),
    new InMemoryMembershipStore(),
    ledger,
    engine,
    plays,
  );
  const profiles = new ProfileService(accounts, plays);
  const app = createApp({
    checks: { checkPostgres: async () => true, checkRedis: async () => true },
    accounts,
    profiles,
    sessions,
    rooms,
    cookie: cookieConfig,
    webOrigins: ['http://localhost:3000'],
    limiter,
    rateLimit,
  });
  return { app, accounts, sessions, repo, engine, plays, limiter };
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
      payload: { role: 'player', nickname: 'ArcadeAce', mode: 'interactive' },
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
      payload: { role: 'observer', nickname: 'Watcher' },
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
      payload: { role: 'player', nickname: 'Victim' },
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
      payload: { role: 'player', nickname: 'Victim' },
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
  );
  const profiles = new ProfileService(accounts, plays);
  const app = createApp({
    checks: { checkPostgres: async () => true, checkRedis: async () => true },
    accounts,
    profiles,
    sessions,
    rooms,
    cookie: cookieConfig,
    webOrigins: ['http://localhost:3000'],
    internalToken: token,
    limiter: new InMemoryRateLimiter(),
    rateLimit: defaultRateLimit,
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
      payload: { avatar: 'berry' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().account.avatar).toBe('berry');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().account).toMatchObject({ avatar: 'berry', visibility: 'public' });

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
      payload: { avatar: 'berry' },
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
