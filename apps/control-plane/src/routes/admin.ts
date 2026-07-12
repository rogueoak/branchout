import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeEmail } from '../accounts/email';
import { AccountService, ValidationError } from '../accounts/service';
import { AdminEmailTakenError, AdminService, type PublicAdmin } from '../admin/service';
import type { AdminSessionStore } from '../admin/session';
import type { AdminCookieConfig, RateLimitConfig } from '../config';
import type { RateLimiter } from '../ratelimit/limiter';

export interface AdminDeps {
  admins: AdminService;
  adminSessions: AdminSessionStore;
  adminCookie: AdminCookieConfig;
  /** The player account service - the console reads/edits players through it. */
  accounts: AccountService;
  /** Reused sign-in limiter (spec 0036); the admin login is keyed on the admin account. */
  limiter: RateLimiter;
  rateLimit: RateLimitConfig;
}

const USERS_PAGE_SIZE = 20;

function asString(body: unknown, key: string): string {
  if (body && typeof body === 'object' && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function tooManyAttempts(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({ error: 'Too many attempts. Please try again later.' });
}

/** Admin cookie options: like the player cookie but ALWAYS host-only (never a Domain) - spec 0037. */
function adminCookieOptions(cookie: AdminCookieConfig) {
  return {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: '/',
    maxAge: cookie.ttlSeconds,
  } as const;
}

/** Register the admin identity + console API under `/admin` (mounted at `/v1/admin`). */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { admins, adminSessions, adminCookie, accounts, limiter, rateLimit } = deps;

  const setAdminCookie = (reply: FastifyReply, sessionId: string): void => {
    reply.setCookie(adminCookie.name, sessionId, adminCookieOptions(adminCookie));
  };
  const clearAdminCookie = (reply: FastifyReply): void => {
    reply.clearCookie(adminCookie.name, { path: '/' });
  };

  /**
   * Read the current admin from the admin cookie. Returns the admin, or sends a 401 and returns null
   * (the caller returns immediately). This is the authoritative gate: every `/admin/*` route except
   * login runs it, regardless of the caller's own gating, so a spoofed/bypassed front cannot get in.
   */
  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<PublicAdmin | null> => {
    const id = request.cookies[adminCookie.name];
    const session = id ? await adminSessions.read(id) : null;
    if (!session) {
      reply.code(401).send({ error: 'Admin sign-in required.' });
      return null;
    }
    const admin = await admins.getById(session.adminId);
    if (!admin) {
      // The admin was removed; treat the stale session as signed out.
      await adminSessions.revoke(session.id);
      clearAdminCookie(reply);
      reply.code(401).send({ error: 'Admin sign-in required.' });
      return null;
    }
    return admin;
  };

  // Admin login: verify against the SEPARATE admin store, open an admin session, set the host-only
  // admin cookie. Rate-limited/locked per admin account (the account is the spoof-resistant anchor).
  app.post('/admin/auth/login', async (request, reply) => {
    const email = asString(request.body, 'email');
    const limitKey = `admin-login:${normalizeEmail(email)}`;
    const verdict = await limiter.check(limitKey, rateLimit.loginMaxAttempts);
    if (verdict.blocked) {
      return tooManyAttempts(reply, verdict.retryAfterSeconds);
    }
    const admin = await admins.login(email, asString(request.body, 'password'));
    if (!admin) {
      await limiter.record(limitKey, rateLimit.loginWindowSeconds);
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }
    await limiter.reset(limitKey);
    const session = await adminSessions.create(admin.id);
    setAdminCookie(reply, session.id);
    return reply.code(200).send({ admin });
  });

  app.post('/admin/auth/logout', async (request, reply) => {
    const id = request.cookies[adminCookie.name];
    if (id) {
      await adminSessions.revoke(id);
    }
    clearAdminCookie(reply);
    return reply.code(200).send({ ok: true });
  });

  // Me: the current admin identity, or null. Used by the console's server-side gate.
  app.get('/admin/auth/me', async (request, reply) => {
    const id = request.cookies[adminCookie.name];
    const session = id ? await adminSessions.read(id) : null;
    const admin = session ? await admins.getById(session.adminId) : null;
    return reply.code(200).send({ admin });
  });

  // Create another admin (admins only; no public signup).
  app.post('/admin/admins', async (request, reply) => {
    const current = await requireAdmin(request, reply);
    if (!current) return reply;
    try {
      const admin = await admins.createAdmin(
        current.id,
        asString(request.body, 'email'),
        asString(request.body, 'password'),
      );
      return reply.code(201).send({ admin });
    } catch (error) {
      if (error instanceof AdminEmailTakenError) {
        return reply.code(409).send({ error: error.message, field: 'email' });
      }
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });

  app.get('/admin/admins', async (request, reply) => {
    const current = await requireAdmin(request, reply);
    if (!current) return reply;
    return reply.code(200).send({ admins: await admins.listAdmins() });
  });

  // Players, by gamer tag, paginated.
  app.get('/admin/users', async (request, reply) => {
    const current = await requireAdmin(request, reply);
    if (!current) return reply;
    const q = request.query as { query?: string; page?: string };
    const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
    const { items, total } = await accounts.listPlayers({
      query: q.query ?? '',
      limit: USERS_PAGE_SIZE,
      offset: (page - 1) * USERS_PAGE_SIZE,
    });
    return reply.code(200).send({ items, total, page, pageSize: USERS_PAGE_SIZE });
  });

  app.get('/admin/users/:id', async (request, reply) => {
    const current = await requireAdmin(request, reply);
    if (!current) return reply;
    const { id } = request.params as { id: string };
    const account = await accounts.getById(id);
    if (!account) {
      return reply.code(404).send({ error: 'User not found.' });
    }
    return reply.code(200).send({ account });
  });

  // Grant or revoke a player's insider role (spec 0035 toggle).
  app.post('/admin/users/:id/insider', async (request, reply) => {
    const current = await requireAdmin(request, reply);
    if (!current) return reply;
    const { id } = request.params as { id: string };
    const insider = (request.body as { insider?: unknown } | null)?.insider;
    try {
      const account = await accounts.changeInsider(id, insider);
      return reply.code(200).send({ account });
    } catch (error) {
      if (error instanceof ValidationError) {
        const code = error.code === 'account' ? 404 : 400;
        return reply.code(code).send({ error: error.message, field: error.code });
      }
      throw error;
    }
  });
}
