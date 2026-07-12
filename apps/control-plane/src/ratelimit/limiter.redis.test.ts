import { describe, expect, it } from 'vitest';
import { type RateLimitRedis, RedisRateLimiter } from './limiter';

/**
 * A fake of the narrow Redis surface the limiter uses, with TTL bookkeeping so the fixed-window and
 * the lost-TTL self-heal paths can be driven without a live Redis. `ttl` returns -2 for a missing
 * key and -1 for a key with no expiry (matching real Redis), which is exactly the anomaly the limiter
 * heals.
 */
class FakeRedis implements RateLimitRedis {
  private readonly counts = new Map<string, number>();
  private readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.counts.has(key) ? String(this.counts.get(key)) : null;
  }
  async incr(key: string): Promise<number> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
  async expire(key: string, seconds: number): Promise<unknown> {
    if (this.counts.has(key)) this.ttls.set(key, seconds);
    return 1;
  }
  async ttl(key: string): Promise<number> {
    if (!this.counts.has(key)) return -2;
    return this.ttls.get(key) ?? -1;
  }
  async del(key: string): Promise<unknown> {
    this.counts.delete(key);
    this.ttls.delete(key);
    return 1;
  }
}

describe('RedisRateLimiter (spec 0036)', () => {
  it('sets the window only on the first hit (fixed window)', async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter(redis);
    await limiter.record('k', 60);
    expect(await redis.get('ratelimit:k')).toBe('1');
    expect(await redis.ttl('ratelimit:k')).toBe(60);
    await limiter.record('k', 999); // a later window value must not extend the window
    expect(await redis.get('ratelimit:k')).toBe('2');
    expect(await redis.ttl('ratelimit:k')).toBe(60);
  });

  it('treats a missing key as zero hits (not blocked)', async () => {
    const limiter = new RedisRateLimiter(new FakeRedis());
    expect(await limiter.check('missing', 5)).toEqual({ blocked: false, retryAfterSeconds: 0 });
  });

  it('blocks at or over the limit with a Retry-After from the TTL', async () => {
    const limiter = new RedisRateLimiter(new FakeRedis());
    for (let i = 0; i < 5; i++) await limiter.record('k', 60);
    const verdict = await limiter.check('k', 5);
    expect(verdict.blocked).toBe(true);
    expect(verdict.retryAfterSeconds).toBe(60);
  });

  it('self-heals a counter that lost its TTL (never permanently locks a key)', async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter(redis);
    // Simulate a crash between INCR and EXPIRE: five increments, no expire -> ttl -1, at the limit.
    for (let i = 0; i < 5; i++) await redis.incr('ratelimit:stuck');
    expect(await redis.ttl('ratelimit:stuck')).toBe(-1);
    // check must clear the orphaned counter and let the actor start fresh, not lock forever.
    expect(await limiter.check('stuck', 5)).toEqual({ blocked: false, retryAfterSeconds: 0 });
    expect(await redis.get('ratelimit:stuck')).toBeNull();
  });

  it('reset clears the counter', async () => {
    const redis = new FakeRedis();
    const limiter = new RedisRateLimiter(redis);
    await limiter.record('k', 60);
    await limiter.reset('k');
    expect(await redis.get('ratelimit:k')).toBeNull();
  });
});
