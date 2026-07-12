/**
 * A small fixed-window rate limiter for the auth endpoints (spec 0036). Deliberately NOT
 * `@fastify/rate-limit`: login needs a *failure* counter that **resets on a successful sign-in** and
 * is keyed on the actor's uncontrollable dimension (the account) - semantics a generic
 * request-per-IP limiter does not model. This mirrors the `SessionStore` shape (a Redis impl for
 * prod, a deterministic in-memory impl for tests), and is the reusable unit the admin login (spec
 * 0037) also uses.
 *
 * The caller owns the key (e.g. `login:<email>` or `signup:<ip>`) and the policy: `check` before
 * acting, `record` a hit, `reset` when the actor proves legitimate. The window is set on the first
 * `record` for a key and the whole counter expires with it - a fixed window, not a sliding one.
 * Fixed-window has a known boundary burst: up to `2 x limit` hits can land across a window edge (limit
 * at the tail of one window, limit at the head of the next). Acceptable for auth lockouts; a consumer
 * that needs a hard smooth rate (e.g. a future admin surface, spec 0037) may want a sliding window.
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
    // A non-numeric value (should never happen) is treated as no hits rather than NaN, which would
    // make `count < limit` false and lock everyone out.
    if (!Number.isFinite(count) || count < limit) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const ttl = await this.redis.ttl(full);
    if (ttl < 0) {
      // A counter at/over the limit with no expiry (ttl -1) is an anomaly - e.g. a crash between the
      // INCR and its EXPIRE left the window unset - which would otherwise lock this key forever. Since
      // `check` runs before `record`, a blocked caller never reaches the code that could re-arm it, so
      // heal it here: drop the orphaned counter and let the actor start a fresh window. This needs a
      // failure at exactly the INCR/EXPIRE seam, so it is not attacker-inducible to shed a live lock.
      await this.redis.del(full);
      return { blocked: false, retryAfterSeconds: 0 };
    }
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
