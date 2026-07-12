import { randomBytes } from 'node:crypto';

/**
 * An admin session (spec 0037). Deliberately its own type and store, NOT the player `Session` - an
 * admin session lives under a separate Redis namespace and rides a distinct, host-only cookie, so a
 * player session can never satisfy the admin gate and an admin session never appears on the public
 * site. The cookie carries only the opaque `id`.
 */
export interface AdminSession {
  id: string;
  adminId: string;
  createdAt: number;
}

/** Generate an unguessable opaque admin-session id (256 bits, url-safe). */
export function newAdminSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** The minimal Redis surface the admin session store needs - fakeable, decoupled from the client. */
export interface AdminSessionRedis {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Persistence for admin sessions - Redis in prod, in-memory in tests. */
export interface AdminSessionStore {
  create(adminId: string): Promise<AdminSession>;
  read(id: string): Promise<AdminSession | null>;
  revoke(id: string): Promise<void>;
}

const KEY_PREFIX = 'admin_session:';

/** Redis-backed admin session store: a JSON blob at `admin_session:<id>` with a sliding TTL. */
export class RedisAdminSessionStore implements AdminSessionStore {
  constructor(
    private readonly redis: AdminSessionRedis,
    private readonly ttlSeconds: number,
  ) {}

  async create(adminId: string): Promise<AdminSession> {
    const session: AdminSession = { id: newAdminSessionId(), adminId, createdAt: Date.now() };
    await this.redis.set(KEY_PREFIX + session.id, JSON.stringify(session), { EX: this.ttlSeconds });
    return session;
  }

  async read(id: string): Promise<AdminSession | null> {
    if (!id) return null;
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return null;
    let session: AdminSession;
    try {
      session = JSON.parse(raw) as AdminSession;
    } catch {
      return null;
    }
    await this.redis.expire(KEY_PREFIX + id, this.ttlSeconds);
    return session;
  }

  async revoke(id: string): Promise<void> {
    if (!id) return;
    await this.redis.del(KEY_PREFIX + id);
  }
}
