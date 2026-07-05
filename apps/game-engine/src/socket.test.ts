import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@branchout/protocol';
import { GameEngine } from './engine';
import { InMemoryPubSub } from './pubsub';
import { GameRegistry } from './registry';
import { NoopReporter } from './reporter';
import { InMemorySessionStore } from './session';
import { attachGameSocket } from './socket';
import { stubGame, STUB_GAME_ID } from './stub-game';

describe('game-engine websocket', () => {
  let server: Server;
  let url: string;
  let engine: GameEngine;

  beforeEach(async () => {
    const pubsub = new InMemoryPubSub();
    engine = new GameEngine({
      registry: new GameRegistry([stubGame]),
      store: new InMemorySessionStore(),
      pubsub,
      reporter: new NoopReporter(),
    });
    server = createServer();
    attachGameSocket(server, engine, pubsub);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const { port } = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const open = (): Promise<WebSocket> => {
    const socket = new WebSocket(url);
    return new Promise((resolve, reject) => {
      socket.on('open', () => resolve(socket));
      socket.on('error', reject);
    });
  };

  /** Resolve with the first frame of the given type this socket receives. */
  const waitFor = (socket: WebSocket, type: string): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      const onMessage = (data: WebSocket.RawData) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed.type === type) {
          socket.off('message', onMessage);
          resolve(parsed);
        }
      };
      socket.on('message', onMessage);
    });

  it('echoes an echo frame (transport health check)', async () => {
    const socket = await open();
    const reply = waitFor(socket, 'echo');
    socket.send(JSON.stringify({ type: 'echo', payload: 'ping' }));
    expect(await reply).toEqual({ type: 'echo', payload: 'ping' });
    socket.close();
  });

  it('answers a malformed frame with an error frame instead of dropping the connection', async () => {
    const socket = await open();
    const reply = waitFor(socket, 'error');
    socket.send('not json');
    expect(typeof (await reply).message).toBe('string');
    socket.close();
  });

  it('binds a joining device and streams the session state snapshot', async () => {
    const startHandoff = {
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: STUB_GAME_ID,
      players: [{ player: 'p1', nickname: 'Ada' }],
      config: { rounds: 1 },
    };
    await engine.start(startHandoff);

    const socket = await open();
    const state = waitFor(socket, 'state');
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'join',
        room: 'r1',
        game: STUB_GAME_ID,
        player: 'p1',
        nickname: 'Ada',
      }),
    );
    const snapshot = await state;
    expect(snapshot).toMatchObject({ type: 'state', room: 'r1', phase: 'collecting' });
    socket.close();
  });

  it('streams prompt/reveal/leaderboard updates as the game advances', async () => {
    await engine.start({
      v: PROTOCOL_VERSION,
      room: 'r2',
      game: STUB_GAME_ID,
      players: [{ player: 'p1', nickname: 'Ada' }],
      config: { rounds: 1, secrets: ['blue'] },
    });

    const socket = await open();
    const received: ServerMessage[] = [];
    socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ServerMessage));

    const joined = waitFor(socket, 'state');
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'join',
        room: 'r2',
        game: STUB_GAME_ID,
        player: 'p1',
        nickname: 'Ada',
      }),
    );
    await joined;

    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'answer',
        room: 'r2',
        game: STUB_GAME_ID,
        player: 'p1',
        round: 1,
        answer: 'blue',
      }),
    );

    // Host advances: reveal -> (no disputes) -> leaderboard -> complete.
    const leaderboard = waitFor(socket, 'leaderboard');
    await engine.control('r2', STUB_GAME_ID, 'advance'); // collecting -> disputing
    await engine.control('r2', STUB_GAME_ID, 'advance'); // disputing -> leaderboard
    const board = await leaderboard;

    expect((board.standings as unknown[]).length).toBe(1);
    expect(received.some((m) => m.type === 'reveal')).toBe(true);
    socket.close();
  });
});
