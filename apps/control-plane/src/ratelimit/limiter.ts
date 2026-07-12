/**
 * A small fixed-window rate limiter for the auth endpoints (spec 0036). Deliberately NOT
 * `@fastify/rate-limit`: login needs a *failure* counter that **resets on a successful sign-in** and
 * is keyed per (account, IP) - semantics a generic request-per-IP limiter does not model. This mirrors
 * the `SessionStore` shape (a Redis impl for prod, a deterministic in-memory impl for tests), and is
 * the reusable unit the admin login (spec 0037) also uses.
 *
 * The caller owns the key (e.g. `login:<email>:<ip>` or `signup:<ip>`) and the policy: `check` before
 * acting, `record` a hit, `reset` when the actor proves legitimate. The window is set on the first
 * `record` for a key and the whole counter expires with it - a fixed window, not a sliding one.
 */
export interface RateVerdict {
  /** True when the key is at or over its limit for the current window. */
  blocked: boolean;
  /** Seconds until the window resets (>= 1 when blocked), for a `Retry-After` header. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Is `key` at or over `limit` right now? Does not count as a hit. */
  check(key: string, limit: number): Promise<RateVerdict>;
  /** Count one hit against `key`; the first hit for a key starts its `windowSeconds` expiry. */
  record(key: string, windowSeconds: number): Promise<void>;
  /** Clear a key's counter (e.g. a successful sign-in un-penalizes earlier typos). */
  reset(key: string): Promise<void>;
}

/** The narrow Redis surface the limiter needs - keeps it decoupled from the full client + fakeable. */
export interface RateLimitRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  del(key: string): Promise<unknown>;
}

const KEY_PREFIX = 'ratelimit:';

/** Redis-backed fixed-window limiter: a counter at `ratelimit:<key>` with a TTL == the window. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RateLimitRedis) {}

  async check(key: string, limit: number): Promise<RateVerdict> {
    const full = KEY_PREFIX + key;
    const raw = await this.redis.get(full);
    const count = raw ? Number(raw) : 0;
    if (count < limit) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const ttl = await this.redis.ttl(full);
    return { blocked: true, retryAfterSeconds: Math.max(1, ttl) };
  }

  async record(key: string, windowSeconds: number): Promise<void> {
    const full = KEY_PREFIX + key;
    const count = await this.redis.incr(full);
    // Only the first hit sets the window, so the whole counter expires together (fixed window).
    if (count === 1) {
      await this.redis.expire(full, windowSeconds);
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key);
  }
}
