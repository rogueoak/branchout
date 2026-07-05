import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app';
import { GameEngine } from './engine';
import { InMemoryPubSub } from './pubsub';
import { GameRegistry } from './registry';
import { NoopReporter } from './reporter';
import { InMemorySessionStore } from './session';
import { attachGameSocket } from './socket';
import { stubGame } from './stub-game';

// Proves the real wiring: the WS adapter mounted on Fastify's underlying HTTP server serves
// realtime traffic on the same server that answers /health, exactly as src/index.ts wires it.
describe('game-engine Fastify + websocket integration', () => {
  const pubsub = new InMemoryPubSub();
  const engine = new GameEngine({
    registry: new GameRegistry([stubGame]),
    store: new InMemorySessionStore(),
    pubsub,
    reporter: new NoopReporter(),
  });
  const app = createApp({ checkRedis: async () => true }, engine);
  let url: string;

  beforeAll(async () => {
    attachGameSocket(app.server, engine, pubsub);
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
