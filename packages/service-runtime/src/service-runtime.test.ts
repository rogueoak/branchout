import { describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { requireEnv } from './env';
import { pingRedis } from './redis';

describe('requireEnv', () => {
  it('returns the value when present', () => {
    expect(requireEnv({ FOO: 'bar' }, 'FOO')).toBe('bar');
  });

  it('throws naming the missing key', () => {
    expect(() => requireEnv({}, 'FOO')).toThrow(/FOO/);
  });
});

describe('pingRedis', () => {
  const fakeClient = (ping: () => Promise<string>) => ({ ping }) as unknown as RedisClientType;

  it('returns true when the client answers PONG', async () => {
    expect(await pingRedis(fakeClient(async () => 'PONG'))).toBe(true);
  });

  it('returns false when the client throws', async () => {
    expect(
      await pingRedis(
        fakeClient(async () => {
          throw new Error('down');
        }),
      ),
    ).toBe(false);
  });
});
