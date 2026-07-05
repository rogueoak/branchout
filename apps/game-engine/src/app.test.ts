import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('game-engine /health', () => {
  it('returns ok when Redis is reachable', async () => {
    const app = createApp({ checkRedis: async () => true });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', redis: 'ok' });
  });

  it('returns 503 degraded when Redis is unreachable', async () => {
    const app = createApp({ checkRedis: async () => false });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', redis: 'unreachable' });
  });
});
