import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('control-plane /health', () => {
  it('returns ok when Postgres and Redis are reachable', async () => {
    const app = createApp({ checkPostgres: async () => true, checkRedis: async () => true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', postgres: 'ok', redis: 'ok' });
    await app.close();
  });

  it('returns 503 degraded when Redis is unreachable', async () => {
    const app = createApp({ checkPostgres: async () => true, checkRedis: async () => false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', postgres: 'ok', redis: 'unreachable' });
    await app.close();
  });

  it('returns 503 degraded when Postgres is unreachable', async () => {
    const app = createApp({ checkPostgres: async () => false, checkRedis: async () => true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', postgres: 'unreachable', redis: 'ok' });
    await app.close();
  });
});
