import { describe, expect, it } from 'vitest';
import type { PasswordHasher } from './accounts/hasher';
import { InMemoryAccountRepository } from './accounts/repository.memory';
import { AccountService } from './accounts/service';
import { createApp } from './app';
import type { SessionCookieConfig } from './config';
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

function makeApp() {
  const repo = new InMemoryAccountRepository();
  const accounts = new AccountService(repo, fakeHasher);
  const sessions = new InMemorySessionStore(3600_000);
  const app = createApp({
    checks: { checkPostgres: async () => true, checkRedis: async () => true },
    accounts,
    sessions,
    cookie: cookieConfig,
    webOrigins: ['http://localhost:3000'],
  });
  return { app, accounts, sessions, repo };
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

describe('POST /auth/signup', () => {
  it('creates an account, sets an httpOnly secure sameSite cookie, and opens a session', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
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
      url: '/auth/me',
      headers: { cookie: sessionCookie(res) },
    });
    expect(me.json()).toMatchObject({ kind: 'account', account: { gamerTag: 'CoolCat' } });
    await app.close();
  });

  it('rejects a duplicate email with 409', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...validSignup, gamerTag: 'Other' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().field).toBe('email');
    await app.close();
  });

  it('rejects a duplicate gamer tag (case-insensitive) with 409', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
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
      url: '/auth/signup',
      payload: { email: 'bad', password: 'short', gamerTag: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /auth/login', () => {
  it('opens a session for correct credentials', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'player@example.com', password: 'supersecret' },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('branchout_session=');
    await app.close();
  });

  it('returns 401 with a generic message for a wrong password', async () => {
    const { app } = makeApp();
    await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
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
      url: '/auth/login',
      payload: { email: 'ghost@example.com', password: 'supersecret' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid email or password.');
    await app.close();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { app } = makeApp();
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const cookie = sessionCookie(signup);

    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('branchout_session=;');

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.json()).toEqual({ kind: 'unauthenticated' });
    await app.close();
  });

  it('is idempotent with no session cookie', async () => {
    const { app } = makeApp();
    const out = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('branchout_session=;');
    await app.close();
  });
});

describe('GET /auth/me', () => {
  it('reports unauthenticated with no cookie', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.json()).toEqual({ kind: 'unauthenticated' });
    await app.close();
  });

  it('reports the display name for an anonymous session', async () => {
    const { app } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest Gonzo' },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: sessionCookie(join) },
    });
    expect(me.json()).toEqual({ kind: 'anonymous', displayName: 'Guest Gonzo' });
    await app.close();
  });

  it('treats a session whose account row is gone as logged out and self-revokes it', async () => {
    const { app, repo } = makeApp();
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const cookie = sessionCookie(signup);
    // Drop the underlying account, leaving a dangling account session.
    repo.deleteById(signup.json().account.id);

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
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
      url: '/auth/anonymous',
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
      url: '/auth/anonymous',
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
      url: '/auth/anonymous',
      payload: { displayName: 'Guest' },
    });
    expect(noCode.statusCode).toBe(400);
    const noName = await app.inject({
      method: 'POST',
      url: '/auth/anonymous',
      payload: { code: 'ROOM42', displayName: '' },
    });
    expect(noName.statusCode).toBe(400);
    await app.close();
  });
});

describe('PATCH /auth/nickname', () => {
  it('changes the nickname for an account session', async () => {
    const { app } = makeApp();
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignup });
    const cookie = sessionCookie(signup);
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/nickname',
      headers: { cookie },
      payload: { nickname: 'The Great Gonzo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.nickname).toBe('The Great Gonzo');

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.json().account.nickname).toBe('The Great Gonzo');
    await app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/nickname',
      payload: { nickname: 'Nope' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an anonymous session with 401 (accounts only)', async () => {
    const { app } = makeApp();
    const join = await app.inject({
      method: 'POST',
      url: '/auth/anonymous',
      payload: { code: 'ROOM42', displayName: 'Guest' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/nickname',
      headers: { cookie: sessionCookie(join) },
      payload: { nickname: 'Nope' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
