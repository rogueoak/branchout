// The player <-> engine WebSocket client, typed end to end against @branchout/protocol (spec
// 0007). It sends join/move/vote out and folds prompt/reveal/leaderboard/state in through the
// pure reducer (game-state.ts), so the only thing this file owns beyond the reducer is the socket
// lifecycle: connect, (re)join, reconnect with a backoff, and a subscribe surface for React.
//
// It is transport-injectable: `socketFactory` defaults to the browser's native WebSocket but a
// test passes a mock, so the message handling is verifiable without a real server.

import {
  PROTOCOL_VERSION,
  serializeMessage,
  type ClientMessage,
  type ServerMessage,
} from '@branchout/protocol';
import {
  initialGameState,
  reduceGameState,
  withConnection,
  type ConnectionStatus,
  type GameState,
} from './game-state';

/** The minimal socket surface the client drives - the shape a native WebSocket adapts to. */
export interface GameSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((error?: unknown) => void) | null;
  onmessage: ((data: string) => void) | null;
}

export interface GameClientOptions {
  /** The engine WebSocket URL, e.g. `ws://localhost:4001`. */
  url: string;
  /** The room id (the control-plane room's id, as used in the start handoff). */
  room: string;
  /** The selected game id, e.g. `trivia`. */
  game: string;
  /** This device's player id - must match the roster the control-plane handed the engine. */
  player: string;
  /** The per-game display name shown to others. */
  nickname: string;
  /**
   * A short-lived engine-join auth token (spec 0064), fetched from the control-plane over this
   * device's own session. It binds the connection to `player`, so the engine rejects a join that
   * claims another player's id. Included on every join (including reconnect). Omitted only in a
   * pure-unit test or a dev engine with no `ENGINE_AUTH_SECRET`, where the engine skips enforcement.
   */
  token?: string;
  /** Override the socket transport (tests inject a mock). */
  socketFactory?: (url: string) => GameSocket;
  /** Base delay before the first reconnect attempt, in ms; doubles each failed attempt. */
  reconnectDelayMs?: number;
  /** Cap on the reconnect backoff, in ms. */
  maxReconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 2000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

/** Adapt the browser's native WebSocket to {@link GameSocket}. */
function nativeSocketFactory(url: string): GameSocket {
  const ws = new WebSocket(url);
  const socket: GameSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onclose = () => socket.onclose?.();
  ws.onerror = (event) => socket.onerror?.(event);
  ws.onmessage = (event: MessageEvent) => socket.onmessage?.(String(event.data));
  return socket;
}

/** Narrow a parsed frame to the server frames (plus `error`) the reducer folds. */
function asServerFrame(value: unknown): ServerMessage | { type: 'error'; message: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (
    type === 'prompt' ||
    type === 'reveal' ||
    type === 'sim' ||
    type === 'leaderboard' ||
    type === 'state' ||
    type === 'move_rejected' ||
    type === 'private'
  ) {
    return value as ServerMessage;
  }
  if (type === 'error') {
    const message = (value as { message?: unknown }).message;
    return { type: 'error', message: typeof message === 'string' ? message : 'protocol error' };
  }
  return null;
}

/**
 * A live engine connection for one player in one game. Construct it, `subscribe` to state, and
 * call `connect`; the client (re)sends the join on every open so a reconnect recovers the session
 * from the engine's snapshot. Call `close` to stop reconnecting and drop the socket.
 */
export class GameClient {
  private readonly options: Required<
    Pick<GameClientOptions, 'reconnectDelayMs' | 'maxReconnectDelayMs'>
  > &
    GameClientOptions;
  private readonly factory: (url: string) => GameSocket;
  private socket: GameSocket | null = null;
  private state: GameState;
  private listeners = new Set<(state: GameState) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  /**
   * The engine-join token sent on the NEXT (re)join (spec 0064). Mutable and separate from the
   * readonly `options` because the token is short-lived: a long game refreshes it out-of-band via
   * {@link updateToken} without rebuilding the socket. Seeded from the initial options.
   */
  private currentToken: string | undefined;

  constructor(options: GameClientOptions) {
    this.options = {
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectDelayMs: DEFAULT_MAX_RECONNECT_DELAY_MS,
      ...options,
    };
    this.currentToken = options.token;
    this.factory = options.socketFactory ?? nativeSocketFactory;
    // Seed the reducer with this device's own player id so it can reject a mis-targeted `private`
    // frame (spec 0052 defense-in-depth) - the reducer has no other source for the local identity.
    this.state = initialGameState(options.player);
  }

  /** The current snapshot. */
  getState(): GameState {
    return this.state;
  }

  /**
   * Replace the engine-join token used on the NEXT (re)connect (spec 0064). The token is short-lived,
   * so a long game refreshes it out-of-band and pushes the new one here without rebuilding the socket
   * (a rebuild would needlessly drop a healthy connection). It takes effect on the next join, which is
   * exactly when a reconnect needs a still-valid token.
   */
  updateToken(token: string | undefined): void {
    this.currentToken = token;
  }

  /** Subscribe to state changes. Returns an unsubscribe. */
  subscribe(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Open the socket (idempotent while already open/connecting). */
  connect(): void {
    if (this.socket || this.closed) return;
    this.setConnection(this.state.joined ? 'reconnecting' : 'connecting');
    const socket = this.factory(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0; // A clean open resets the backoff.
      this.setConnection('live');
      this.send({
        v: PROTOCOL_VERSION,
        type: 'join',
        room: this.options.room,
        game: this.options.game,
        player: this.options.player,
        nickname: this.options.nickname,
        // Authenticate the join (spec 0064) with the current (possibly refreshed) token. Additive on
        // the wire: a join without one is still well-formed; the engine only requires it when its
        // secret is set.
        ...(this.currentToken ? { token: this.currentToken } : {}),
      });
    };
    socket.onmessage = (data) => this.handleMessage(data);
    socket.onclose = () => this.handleClose();
    socket.onerror = () => {
      // A transport error is followed by a close; let handleClose drive the reconnect. Surfacing
      // it here too would double-schedule.
    };
  }

  /** Stop reconnecting and close the socket. */
  close(): void {
    this.closed = true;
    this.clearReconnect();
    this.setConnection('closed');
    this.socket?.close();
    this.socket = null;
  }

  /** Submit this player's free-text move for a round. */
  submitMove(round: number, move: string): void {
    this.send({
      v: PROTOCOL_VERSION,
      type: 'move',
      room: this.options.room,
      game: this.options.game,
      player: this.options.player,
      round,
      move,
    });
  }

  /**
   * Cast a generic vote frame (`target`, `agree`) - the game-agnostic action every UI module uses.
   * The engine reads it by phase: a Trivia dispute (target = self) / ballot (target = disputer), or
   * a Liar Liar guess (target = chosen option id, agree = true). The game module owns what it means.
   */
  submitVote(round: number, target: string, agree: boolean): void {
    this.vote(round, target, agree);
  }

  private vote(round: number, target: string, agree: boolean): void {
    this.send({
      v: PROTOCOL_VERSION,
      type: 'vote',
      room: this.options.room,
      game: this.options.game,
      player: this.options.player,
      round,
      target,
      agree,
    });
  }

  private send(message: ClientMessage): void {
    this.socket?.send(serializeMessage(message));
  }

  private handleMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // A frame we cannot parse is dropped; the engine owns well-formed output.
    }
    const frame = asServerFrame(parsed);
    if (!frame) return;
    this.state = reduceGameState(this.state, frame);
    this.emit();
  }

  private handleClose(): void {
    this.socket = null;
    if (this.closed) return;
    this.setConnection('reconnecting');
    this.clearReconnect();
    // Exponential backoff capped at maxReconnectDelayMs, so a persistently-down engine is retried
    // without hammering it. The delay resets to the base on the next clean open.
    const delay = Math.min(
      this.options.reconnectDelayMs * 2 ** this.reconnectAttempts,
      this.options.maxReconnectDelayMs,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnection(connection: ConnectionStatus): void {
    if (this.state.connection === connection) return;
    this.state = withConnection(this.state, connection);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
