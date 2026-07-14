import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { V1_PREFIX } from '@branchout/protocol';
import { createApp } from './app';
import { GameEngine } from './engine';
import { InMemoryPubSub } from './pubsub';
import { InProcessRuntimeProvider } from './worker/runtime';
import { NoopReporter } from './reporter';
import { InMemorySessionStore } from './session';
import { attachGameSocket } from './socket';
import { stubGame } from '@branchout/game-sdk/testing';

// Proves the real wiring: the WS adapter mounted on Fastify's underlying HTTP server serves
// realtime traffic on the same server that answers /health, exactly as src/index.ts wires it.
describe('game-engine Fastify + websocket integration', () => {
  const pubsub = new InMemoryPubSub();
  const engine = new GameEngine({
    runtimeProvider: new InProcessRuntimeProvider([stubGame]),
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
    // Connect at the versioned path (spec 0033): the engine ws server must accept `/v1`, so the
    // client's versioned connect URL and the server agree - the seam the reporter fix taught us to
    // pin rather than leave to two unproven ends.
    url = `ws://127.0.0.1:${port}${V1_PREFIX}`;
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
