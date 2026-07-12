import type { RateLimiter, RateVerdict } from './limiter';

/**
 * In-memory rate limiter for tests. Models the fixed window with a numeric clock so expiry is
 * deterministic: pass `now()` to control time and advance it in a test to lapse a window without
 * waiting. Same behaviour contract as `RedisRateLimiter`.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** The live counter for a key, or null once its window has lapsed (dropping the stale entry). */
  private live(key: string): { count: number; expiresAt: number } | null {
    const entry = this.counters.get(key);
    if (!entry) {
      return null;
    }
    if (this.now() >= entry.expiresAt) {
      this.counters.delete(key);
      return null;
    }
    return entry;
  }

  async check(key: string, limit: number): Promise<RateVerdict> {
    const entry = this.live(key);
    const count = entry?.count ?? 0;
    if (count < limit) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((entry!.expiresAt - this.now()) / 1000));
    return { blocked: true, retryAfterSeconds };
  }

  async record(key: string, windowSeconds: number): Promise<void> {
    const entry = this.live(key);
    if (entry) {
      entry.count += 1;
    } else {
      this.counters.set(key, { count: 1, expiresAt: this.now() + windowSeconds * 1000 });
    }
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key);
  }
}
