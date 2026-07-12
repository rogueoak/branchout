import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeEmail } from '../accounts/email';
import { AccountService, ConflictError, ValidationError } from '../accounts/service';
import type { RateLimitConfig, SessionCookieConfig } from '../config';
import type { RateLimiter } from '../ratelimit/limiter';
import type { Session } from '../sessions/session';
import type { SessionStore } from '../sessions/store';
import { validateDisplayName } from '../validation/display-name';

export interface AuthDeps {
  accounts: AccountService;
  sessions: SessionStore;
  cookie: SessionCookieConfig;
  /** Rate limiter for the sign-in / sign-up lockouts (spec 0036). */
  limiter: RateLimiter;
  /** Rate-limit thresholds. */
  rateLimit: RateLimitConfig;
}

/** A uniform 429 that reveals nothing about the account (no enumeration via wording or status). */
function tooManyAttempts(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({ error: 'Too many attempts. Please try again later.' });
}

/** Read a string field from an unknown JSON body without trusting its type. */
function asString(body: unknown, key: string): string {
  if (body && typeof body === 'object' && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function cookieOptions(cookie: SessionCookieConfig) {
  return {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    // A parent domain (spec 0035) makes one session span the apex + subdomains; omitted keeps it
    // host-only. Spread so an unset domain never emits `Domain=undefined`.
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    path: '/',
    maxAge: cookie.ttlSeconds,
  } as const;
}

/** Register the auth + identity endpoints on the app. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { accounts, sessions, cookie, limiter, rateLimit } = deps;

  const setSessionCookie = (reply: FastifyReply, session: Session): void => {
    reply.setCookie(cookie.name, session.id, cookieOptions(cookie));
  };

  const clearSessionCookie = (reply: FastifyReply): void => {
    // Match path + domain so a domain-scoped session cookie (spec 0035) is actually cleared, not
    // shadowed by a lingering host-only clear.
    reply.clearCookie(cookie.name, {
      path: '/',
      ...(cookie.domain ? { domain: cookie.domain } : {}),
    });
  };

  const currentSession = async (request: FastifyRequest): Promise<Session | null> => {
    const id = request.cookies[cookie.name];
    if (!id) {
      return null;
    }
    return sessions.read(id);
  };

  // Sign up: create the account, then open an account session. Capped per client IP so one source
  // cannot mass-create accounts; every attempt (valid or not) counts against the cap. The IP is
  // trustworthy on the edge-fronted path: Caddy replaces X-Forwarded-For with the true peer (spec
  // 0038), so a source cannot rotate XFF past the cap. (A direct dev call to the published
  // control-plane port has no Caddy, so request.ip is unsanitized there - dev is not a trust boundary.)
  app.post('/auth/signup', async (request, reply) => {
    const limitKey = `signup:${request.ip}`;
    const verdict = await limiter.check(limitKey, rateLimit.signupMaxPerIp);
    if (verdict.blocked) {
      return tooManyAttempts(reply, verdict.retryAfterSeconds);
    }
    await limiter.record(limitKey, rateLimit.signupWindowSeconds);
    try {
      const account = await accounts.signup({
        email: asString(request.body, 'email'),
        password: asString(request.body, 'password'),
        gamerTag: asString(request.body, 'gamerTag'),
      });
      const session = await sessions.create({
        kind: 'account',
        accountId: account.id,
        displayName: account.nickname,
      });
      setSessionCookie(reply, session);
      return reply.code(201).send({ account });
    } catch (error) {
      if (error instanceof ConflictError) {
        return reply
          .code(409)
          .send({ error: `That ${labelFor(error.field)} is already taken.`, field: error.field });
      }
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });

  // Log in: verify credentials, then open an account session. A wrong email or password both
  // return the same 401 so the response never reveals which field was wrong. Failed attempts lock
  // per ACCOUNT (the submitted email), NOT per (account, IP). The account is the anchor on its own
  // merit: an attacker brute-forcing one account can come from many source IPs (a botnet has real,
  // distinct ones), so a per-IP or per-(account,IP) key just splits the attack into many buckets and
  // never trips - the target account is the one dimension that stays constant. (This holds regardless
  // of whether the IP itself is trustworthy; spec 0038 sanitizes the IP at the edge, but that helps
  // the per-IP signup cap, not this.) A successful sign-in clears the counter so earlier typos never
  // punish a legitimate user. Tradeoff: account-only lockout lets someone briefly (one window) lock a
  // targeted account by failing logins - the standard account-lockout tradeoff, bounded by the short
  // window; softening it (CAPTCHA / progressive delay) is a future enhancement.
  app.post('/auth/login', async (request, reply) => {
    const email = asString(request.body, 'email');
    const limitKey = `login:${normalizeEmail(email)}`;
    const verdict = await limiter.check(limitKey, rateLimit.loginMaxAttempts);
    if (verdict.blocked) {
      return tooManyAttempts(reply, verdict.retryAfterSeconds);
    }
    const account = await accounts.login({ email, password: asString(request.body, 'password') });
    if (!account) {
      await limiter.record(limitKey, rateLimit.loginWindowSeconds);
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }
    await limiter.reset(limitKey);
    const session = await sessions.create({
      kind: 'account',
      accountId: account.id,
      displayName: account.nickname,
    });
    setSessionCookie(reply, session);
    return reply.code(200).send({ account });
  });

  // Log out: revoke the server session and clear the cookie. Idempotent.
  app.post('/auth/logout', async (request, reply) => {
    const id = request.cookies[cookie.name];
    if (id) {
      await sessions.revoke(id);
    }
    clearSessionCookie(reply);
    return reply.code(200).send({ ok: true });
  });

  // Me: report the current identity. Account, anonymous, or unauthenticated.
  app.get('/auth/me', async (request, reply) => {
    const session = await currentSession(request);
    if (!session) {
      return reply.code(200).send({ kind: 'unauthenticated' });
    }
    if (session.kind === 'anonymous') {
      return reply.code(200).send({ kind: 'anonymous', displayName: session.displayName });
    }
    // Account session: load the live identity so a nickname change is reflected.
    const account = session.accountId ? await accounts.getById(session.accountId) : null;
    if (!account) {
      // The account is gone (deleted); treat the stale session as logged out.
      await sessions.revoke(session.id);
      clearSessionCookie(reply);
      return reply.code(200).send({ kind: 'unauthenticated' });
    }
    return reply.code(200).send({ kind: 'account', account });
  });

  // Change nickname: account sessions only. The per-game override is set at room join (0006).
  app.patch('/auth/nickname', async (request, reply) => {
    const session = await currentSession(request);
    if (!session || session.kind !== 'account' || !session.accountId) {
      return reply.code(401).send({ error: 'Sign in to change your nickname.' });
    }
    try {
      const account = await accounts.changeNickname(
        session.accountId,
        asString(request.body, 'nickname'),
      );
      return reply.code(200).send({ account });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });

  // Change avatar: account sessions only. The id is validated against the bounded set in the service.
  app.patch('/auth/avatar', async (request, reply) => {
    const session = await currentSession(request);
    if (!session || session.kind !== 'account' || !session.accountId) {
      return reply.code(401).send({ error: 'Sign in to change your avatar.' });
    }
    try {
      const account = await accounts.changeAvatar(
        session.accountId,
        asString(request.body, 'avatar'),
      );
      return reply.code(200).send({ account });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });

  // Change profile visibility: account sessions only.
  app.patch('/auth/visibility', async (request, reply) => {
    const session = await currentSession(request);
    if (!session || session.kind !== 'account' || !session.accountId) {
      return reply.code(401).send({ error: 'Sign in to change your privacy.' });
    }
    try {
      const account = await accounts.changeVisibility(
        session.accountId,
        asString(request.body, 'visibility'),
      );
      return reply.code(200).send({ account });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });

  // Anonymous join-by-code: mint an ephemeral session with a display name and no account row.
  // It carries a session id and display name only and cannot host (see canHost).
  app.post('/auth/anonymous', async (request, reply) => {
    const code = asString(request.body, 'code').trim();
    if (!code) {
      return reply.code(400).send({ error: 'A room code is required to join.', field: 'code' });
    }
    const displayName = validateDisplayName(asString(request.body, 'displayName'));
    if (!displayName.ok) {
      return reply.code(400).send({ error: displayName.error, field: 'displayName' });
    }
    const session = await sessions.create({
      kind: 'anonymous',
      displayName: displayName.value!,
      roomCode: code,
    });
    setSessionCookie(reply, session);
    return reply.code(201).send({ kind: 'anonymous', displayName: session.displayName });
  });
}

function labelFor(field: 'email' | 'gamerTag'): string {
  return field === 'gamerTag' ? 'gamer tag' : 'email';
}
