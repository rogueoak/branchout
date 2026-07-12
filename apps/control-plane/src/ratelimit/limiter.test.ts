import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './limiter.memory';

describe('InMemoryRateLimiter (spec 0036)', () => {
  it('does not block until the limit is reached, then blocks with a retry-after', async () => {
    const limiter = new InMemoryRateLimiter();
    // Under the limit of 3: two hits, still allowed.
    await limiter.record('k', 900);
    await limiter.record('k', 900);
    expect(await limiter.check('k', 3)).toEqual({ blocked: false, retryAfterSeconds: 0 });
    // Third hit reaches the limit.
    await limiter.record('k', 900);
    const verdict = await limiter.check('k', 3);
    expect(verdict.blocked).toBe(true);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('reset clears the counter (a legitimate sign-in un-penalizes earlier misses)', async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.record('k', 900);
    await limiter.record('k', 900);
    await limiter.record('k', 900);
    expect((await limiter.check('k', 3)).blocked).toBe(true);
    await limiter.reset('k');
    expect(await limiter.check('k', 3)).toEqual({ blocked: false, retryAfterSeconds: 0 });
  });

  it('expires the whole window on a fixed clock (blocked, then allowed once it lapses)', async () => {
    let clock = 0;
    const limiter = new InMemoryRateLimiter(() => clock);
    await limiter.record('k', 60); // window: 60s from t=0
    await limiter.record('k', 60);
    await limiter.record('k', 60);
    expect((await limiter.check('k', 3)).blocked).toBe(true);
    // Still inside the window.
    clock = 59_000;
    expect((await limiter.check('k', 3)).blocked).toBe(true);
    // Past the window - counter lapses, allowed again.
    clock = 60_000;
    expect(await limiter.check('k', 3)).toEqual({ blocked: false, retryAfterSeconds: 0 });
  });

  it('keeps separate keys independent', async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.record('a', 900);
    await limiter.record('a', 900);
    await limiter.record('a', 900);
    expect((await limiter.check('a', 3)).blocked).toBe(true);
    expect((await limiter.check('b', 3)).blocked).toBe(false);
  });
});
