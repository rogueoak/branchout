import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('control-plane /health', () => {
  it('returns ok when Postgres and Redis are reachable', async () => {
    const app = createApp({ checkPostgres: async () => true, checkRedis: async () => true });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', postgres: 'ok', redis: 'ok' });
  });

  it('returns 503 degraded when a dependency is unreachable', async () => {
    const app = createApp({ checkPostgres: async () => true, checkRedis: async () => false });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', postgres: 'ok', redis: 'unreachable' });
  });
});
