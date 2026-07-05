import { randomBytes } from 'node:crypto';
import type { Session, SessionKind } from './session';

/** Fields needed to open a session; the store assigns the id and timestamp. */
export interface CreateSessionInput {
  kind: SessionKind;
  displayName: string;
  accountId?: string;
  roomCode?: string;
}

/**
 * Server-side session storage. An opaque id lives in the cookie; the session body lives here
 * with a sliding TTL. Backed by Redis in production (revocable, tiny cookie) and by an
 * in-memory map in tests. See spec 0004 for the server-session vs JWT trade-off.
 */
export interface SessionStore {
  /** Create and persist a session, returning it with its new opaque id. */
  create(input: CreateSessionInput): Promise<Session>;
  /** Load a session by id, refreshing its TTL (sliding expiry). Null if missing or expired. */
  read(id: string): Promise<Session | null>;
  /** Delete a session so its cookie is dead immediately (log out, ban, force logout). */
  revoke(id: string): Promise<void>;
}

/** Generate an unguessable opaque session id (256 bits, url-safe). */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** The minimal Redis surface the session store needs. Keeps the store decoupled from the full
 * client type and trivially fakeable. */
export interface SessionRedis {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const KEY_PREFIX = 'session:';

/**
 * Redis-backed session store. Each session is a JSON blob at `session:<id>` with a TTL. A
 * read refreshes the TTL, giving a sliding expiry: active sessions stay alive, idle ones lapse.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: SessionRedis,
    /** Time-to-live in seconds; refreshed on every read. */
    private readonly ttlSeconds: number,
  ) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: newSessionId(),
      kind: input.kind,
      displayName: input.displayName,
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.roomCode !== undefined ? { roomCode: input.roomCode } : {}),
      createdAt: Date.now(),
    };
    await this.redis.set(KEY_PREFIX + session.id, JSON.stringify(session), {
      EX: this.ttlSeconds,
    });
    return session;
  }

  async read(id: string): Promise<Session | null> {
    if (!id) {
      return null;
    }
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) {
      return null;
    }
    let session: Session;
    try {
      session = JSON.parse(raw) as Session;
    } catch {
      // A corrupt entry is treated as no session rather than crashing the request.
      return null;
    }
    // Sliding expiry: a live session pushes its own deadline out on use.
    await this.redis.expire(KEY_PREFIX + id, this.ttlSeconds);
    return session;
  }

  async revoke(id: string): Promise<void> {
    if (!id) {
      return;
    }
    await this.redis.del(KEY_PREFIX + id);
  }
}
