import type { ClientMessage } from '@branchout/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameClient, type GameClientOptions, type GameSocket } from './game-client';

/** A hand-driven socket: the test fires onopen/onmessage/onclose and inspects what was sent. */
class MockSocket implements GameSocket {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  onmessage: ((data: string) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }

  /** The parsed client frames this socket received, in order. */
  frames(): ClientMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ClientMessage);
  }
}

function makeClient(overrides: Partial<GameClientOptions> = {}) {
  const sockets: MockSocket[] = [];
  const client = new GameClient({
    url: 'ws://engine',
    room: 'room1',
    game: 'trivia',
    player: 'p1',
    nickname: 'Ada',
    reconnectDelayMs: 10,
    socketFactory: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket;
    },
    ...overrides,
  });
  return { client, sockets };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GameClient', () => {
  it('sends a join frame on open, carrying the player identity', () => {
    const { client, sockets } = makeClient();
    client.connect();
    expect(client.getState().connection).toBe('connecting');

    sockets[0]!.onopen?.();
    expect(client.getState().connection).toBe('live');

    const join = sockets[0]!.frames()[0];
    expect(join).toMatchObject({
      type: 'join',
      room: 'room1',
      game: 'trivia',
      player: 'p1',
      nickname: 'Ada',
    });
  });

  it('folds an incoming state frame into subscribed state', () => {
    const { client, sockets } = makeClient();
    const seen: string[] = [];
    client.subscribe((state) => seen.push(state.phase));
    client.connect();
    sockets[0]!.onopen?.();

    sockets[0]!.onmessage?.(
      JSON.stringify({
        v: 1,
        type: 'state',
        room: 'room1',
        game: 'trivia',
        phase: 'collecting',
        paused: false,
        round: 1,
        players: [{ player: 'p1', nickname: 'Ada', connected: true }],
        scores: { p1: 0 },
        disputes: [],
      }),
    );

    expect(client.getState().phase).toBe('collecting');
    expect(client.getState().joined).toBe(true);
    expect(seen).toContain('collecting');
  });

  it('ignores an unparseable or unknown frame', () => {
    const { client, sockets } = makeClient();
    client.connect();
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.('not json');
    sockets[0]!.onmessage?.(JSON.stringify({ type: 'mystery' }));
    expect(client.getState().joined).toBe(false);
  });

  it('sends answer and generic vote frames', () => {
    const { client, sockets } = makeClient();
    client.connect();
    sockets[0]!.onopen?.();

    client.submitAnswer(2, 'water');
    // The one generic vote action carries every game's vote: a Trivia dispute (target = self) or
    // ballot, or a Liar Liar guess (target = the chosen option id).
    client.submitVote(2, 'p1', true);
    client.submitVote(2, 'p3', true);

    const frames = sockets[0]!.frames().slice(1); // drop the join
    expect(frames[0]).toMatchObject({ type: 'answer', round: 2, answer: 'water', player: 'p1' });
    expect(frames[1]).toMatchObject({ type: 'vote', round: 2, target: 'p1', agree: true });
    expect(frames[2]).toMatchObject({ type: 'vote', round: 2, target: 'p3', agree: true });
  });

  it('reconnects after an unexpected close, re-sending the join', () => {
    vi.useFakeTimers();
    const { client, sockets } = makeClient();
    client.connect();
    sockets[0]!.onopen?.();
    // Prove we are joined so the reconnect status (not the first connect) is asserted.
    sockets[0]!.onmessage?.(
      JSON.stringify({
        v: 1,
        type: 'state',
        room: 'room1',
        game: 'trivia',
        phase: 'collecting',
        paused: false,
        round: 1,
        players: [],
        scores: {},
        disputes: [],
      }),
    );

    sockets[0]!.onclose?.();
    expect(client.getState().connection).toBe('reconnecting');

    vi.advanceTimersByTime(10);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen?.();
    expect(sockets[1]!.frames()[0]).toMatchObject({ type: 'join' });
  });

  it('backs off exponentially across repeated failures', () => {
    vi.useFakeTimers();
    const { client, sockets } = makeClient({ reconnectDelayMs: 100, maxReconnectDelayMs: 1000 });
    client.connect();
    sockets[0]!.onopen?.();

    // First failure: base delay of 100ms.
    sockets[0]!.onclose?.();
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // Second failure without a clean open in between: the delay doubles to 200ms.
    sockets[1]!.onclose?.();
    vi.advanceTimersByTime(199);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('stops reconnecting once closed', () => {
    vi.useFakeTimers();
    const { client, sockets } = makeClient();
    client.connect();
    sockets[0]!.onopen?.();

    client.close();
    expect(client.getState().connection).toBe('closed');
    expect(sockets[0]!.closed).toBe(true);

    // A late close event must not schedule a reconnect.
    sockets[0]!.onclose?.();
    vi.advanceTimersByTime(50);
    expect(sockets).toHaveLength(1);
  });
});
