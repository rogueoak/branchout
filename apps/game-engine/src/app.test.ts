import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('game-engine /health', () => {
  it('returns ok when Redis is reachable', async () => {
    const app = createApp({ checkRedis: async () => true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', redis: 'ok' });
    await app.close();
  });

  it('returns 503 degraded when Redis is unreachable', async () => {
    const app = createApp({ checkRedis: async () => false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', redis: 'unreachable' });
    await app.close();
  });
});
