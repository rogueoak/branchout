import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app';
import { attachGameSocket } from './socket';

// Proves the real wiring: the WS adapter mounted on Fastify's underlying HTTP server serves
// realtime traffic on the same server that answers /health, exactly as src/index.ts wires it.
describe('game-engine Fastify + websocket integration', () => {
  const app = createApp({ checkRedis: async () => true });
  let url: string;

  beforeAll(async () => {
    attachGameSocket(app.server);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves /health over http and echoes over ws on the same server', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const socket = new WebSocket(url);
    const reply = await new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ type: 'echo', payload: 'ping' })));
      socket.on('message', (data) => {
        resolve(data.toString());
        socket.close();
      });
      socket.on('error', reject);
    });
    expect(JSON.parse(reply)).toEqual({ type: 'echo', payload: 'ping' });
  });
});
