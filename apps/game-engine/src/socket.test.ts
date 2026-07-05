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

  const firstReply = (payload: string): Promise<string> => {
    const socket = new WebSocket(url);
    return new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send(payload));
      socket.on('message', (data) => {
        resolve(data.toString());
        socket.close();
      });
      socket.on('error', reject);
    });
  };

  it('accepts a connection and echoes a message', async () => {
    const reply = await firstReply(JSON.stringify({ type: 'echo', payload: 'ping' }));
    expect(JSON.parse(reply)).toEqual({ type: 'echo', payload: 'ping' });
  });

  it('answers a malformed frame with an error frame instead of dropping the connection', async () => {
    const reply = await firstReply('not json');
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe('error');
    expect(typeof parsed.message).toBe('string');
  });
});
