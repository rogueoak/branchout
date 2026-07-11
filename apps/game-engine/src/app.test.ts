import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { createApp } from './app';
import { GameEngine } from './engine';
import { GameRegistry } from './registry';
import { NoopReporter } from './reporter';
import { InMemoryPubSub } from './pubsub';
import { InMemorySessionStore } from './session';
import { stubGame, STUB_GAME_ID } from '@branchout/game-sdk/testing';

function buildEngine() {
  return new GameEngine({
    registry: new GameRegistry([stubGame]),
    store: new InMemorySessionStore(),
    pubsub: new InMemoryPubSub(),
    reporter: new NoopReporter(),
  });
}

function appWithRedis(reachable: boolean) {
  return createApp({ checkRedis: async () => reachable }, buildEngine());
}

const handoff = {
  v: PROTOCOL_VERSION,
  room: 'r1',
  game: STUB_GAME_ID,
  players: [{ player: 'p1', nickname: 'Ada' }],
  config: { rounds: 2 },
};

describe('game-engine /health', () => {
  it('returns ok when Redis is reachable', async () => {
    const app = appWithRedis(true);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', redis: 'ok' });
    await app.close();
  });

  it('returns 503 degraded when Redis is unreachable', async () => {
    const app = appWithRedis(false);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', redis: 'unreachable' });
    await app.close();
  });
});

describe('game-engine API versioning (spec 0033)', () => {
  it('serves /sessions under /v1 and 404s the un-versioned path', async () => {
    const app = appWithRedis(true);
    const versioned = await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });
    expect(versioned.statusCode).toBe(200);
    // The bare path no longer resolves - the relocation is real, not an alias.
    const bare = await app.inject({ method: 'POST', url: '/sessions', payload: handoff });
    expect(bare.statusCode).toBe(404);
    await app.close();
  });

  it('keeps /health un-versioned (there is no /v1/health)', async () => {
    const app = appWithRedis(true);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('game-engine /sessions start handoff', () => {
  it('starts a session and is idempotent on retry', async () => {
    const app = appWithRedis(true);

    const first = await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'started', room: 'r1', game: STUB_GAME_ID });

    const retry = await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ status: 'running' });

    await app.close();
  });

  it('rejects a malformed handoff body', async () => {
    const app = appWithRedis(true);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { v: PROTOCOL_VERSION, room: 'r1' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects an unknown game id', async () => {
    const app = appWithRedis(true);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { ...handoff, game: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('game-engine /sessions control', () => {
  it('applies a host control and 404s an unknown session', async () => {
    const app = appWithRedis(true);
    await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });

    const advance = await app.inject({
      method: 'POST',
      url: `/v1/sessions/r1/${STUB_GAME_ID}/control`,
      payload: { action: 'advance' },
    });
    expect(advance.statusCode).toBe(200);

    const missing = await app.inject({
      method: 'POST',
      url: `/v1/sessions/nope/${STUB_GAME_ID}/control`,
      payload: { action: 'advance' },
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it('rejects an unknown control action', async () => {
    const app = appWithRedis(true);
    await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/r1/${STUB_GAME_ID}/control`,
      payload: { action: 'explode' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('inspects a session as the protocol state projection, not the raw internals', async () => {
    const app = appWithRedis(true);
    await app.inject({ method: 'POST', url: '/v1/sessions', payload: handoff });
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/r1/${STUB_GAME_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ type: 'state', room: 'r1', phase: 'collecting', round: 1 });
    // The projection must not leak the module scratch or the opaque config.
    expect(body.scratch).toBeUndefined();
    expect(body.config).toBeUndefined();
    await app.close();
  });
});
