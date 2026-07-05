import { describe, expect, it, vi } from 'vitest';
import { InMemorySessionStore } from './store.memory';
import { RedisSessionStore, type SessionRedis } from './store';

/** A fake Redis that stores string values in a map and records expire calls. */
function createFakeRedis() {
  const store = new Map<string, string>();
  const redis: SessionRedis = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
  };
  return { redis, store };
}

describe('RedisSessionStore', () => {
  it('creates a session with an opaque id and stores it under a session key', async () => {
    const { redis, store } = createFakeRedis();
    const sessions = new RedisSessionStore(redis, 3600);
    const session = await sessions.create({
      kind: 'account',
      accountId: 'acct_1',
      displayName: 'Cat',
    });

    expect(session.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.id.length).toBeGreaterThanOrEqual(40);
    expect(store.has(`session:${session.id}`)).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(`session:${session.id}`, expect.any(String), {
      EX: 3600,
    });
  });

  it('reads a session back and refreshes its TTL (sliding expiry)', async () => {
    const { redis } = createFakeRedis();
    const sessions = new RedisSessionStore(redis, 3600);
    const created = await sessions.create({
      kind: 'anonymous',
      displayName: 'Guest',
      roomCode: 'AB',
    });

    const read = await sessions.read(created.id);
    expect(read?.displayName).toBe('Guest');
    expect(read?.roomCode).toBe('AB');
    expect(redis.expire).toHaveBeenCalledWith(`session:${created.id}`, 3600);
  });

  it('returns null for an unknown id and does not refresh a missing key', async () => {
    const { redis } = createFakeRedis();
    const sessions = new RedisSessionStore(redis, 3600);
    expect(await sessions.read('nope')).toBeNull();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('revokes a session so a later read misses', async () => {
    const { redis } = createFakeRedis();
    const sessions = new RedisSessionStore(redis, 3600);
    const created = await sessions.create({
      kind: 'account',
      accountId: 'acct_1',
      displayName: 'Cat',
    });
    await sessions.revoke(created.id);
    expect(await sessions.read(created.id)).toBeNull();
  });

  it('treats a corrupt stored value as no session', async () => {
    const { redis, store } = createFakeRedis();
    const sessions = new RedisSessionStore(redis, 3600);
    store.set('session:broken', '{not json');
    expect(await sessions.read('broken')).toBeNull();
  });
});

describe('InMemorySessionStore', () => {
  it('creates, reads, and revokes', async () => {
    const store = new InMemorySessionStore(1000);
    const session = await store.create({
      kind: 'account',
      accountId: 'acct_1',
      displayName: 'Cat',
    });
    expect((await store.read(session.id))?.displayName).toBe('Cat');
    await store.revoke(session.id);
    expect(await store.read(session.id)).toBeNull();
  });

  it('lapses a session after its TTL with no activity', async () => {
    let now = 0;
    const store = new InMemorySessionStore(1000, () => now);
    const session = await store.create({ kind: 'anonymous', displayName: 'Guest' });
    now = 1001;
    expect(await store.read(session.id)).toBeNull();
  });

  it('slides the expiry forward on each read', async () => {
    let now = 0;
    const store = new InMemorySessionStore(1000, () => now);
    const session = await store.create({ kind: 'anonymous', displayName: 'Guest' });
    now = 900;
    expect(await store.read(session.id)).not.toBeNull(); // refreshes deadline to 1900
    now = 1800;
    expect(await store.read(session.id)).not.toBeNull(); // still alive thanks to the slide
    now = 2900;
    expect(await store.read(session.id)).toBeNull();
  });
});
