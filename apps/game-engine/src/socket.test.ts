import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachGameSocket } from './socket';

describe('game-engine websocket', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer();
    attachGameSocket(server);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const { port } = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts a connection and echoes a message', async () => {
    const socket = new WebSocket(url);
    const reply = await new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ type: 'echo', payload: 'ping' })));
      socket.on('message', (data) => resolve(data.toString()));
      socket.on('error', reject);
    });
    socket.close();
    expect(JSON.parse(reply)).toEqual({ type: 'echo', payload: 'ping' });
  });
});
