import type { Server as HttpServer } from 'node:http';
import type {
  ClientMessage,
  JoinMessage,
  SocketConnection,
  SocketServer,
} from '@branchout/protocol';
import { createWsServer } from '@branchout/protocol/ws';
import type { GameEngine } from './engine';
import { privateChannel, streamChannel, type PubSub, type Subscription } from './pubsub';

/** Per-connection binding: which session this device joined and its stream subscriptions. */
interface Bound {
  room: string;
  game: string;
  player: string;
  /** The session broadcast subscription (every device's public frames). */
  subscription: Subscription;
  /**
   * The per-player private subscription (spec 0052): this device's own hidden-information channel.
   * Only this player's connection(s) subscribe to it, so a targeted `private` frame the engine
   * publishes reaches this device alone and never any other player - the secrecy guarantee.
   */
  privateSubscription: Subscription;
}

/**
 * Attach the realtime endpoint and route player frames to the engine. A device connects, sends a
 * `join`, and is bound to a room/game/player; the engine's streamed frames for that session are
 * forwarded to it via pub/sub. `move` and `vote` frames are accepted only for the session the
 * device joined, so one socket cannot act on another room's game.
 *
 * `echo` still round-trips as a transport health check.
 */
export function attachGameSocket(
  server: HttpServer,
  engine: GameEngine,
  pubsub: PubSub,
): SocketServer {
  const bindings = new Map<SocketConnection, Bound>();

  const fail = (connection: SocketConnection, message: string) => {
    connection.send({ type: 'error', message });
  };

  const handleJoin = async (connection: SocketConnection, message: JoinMessage) => {
    if (bindings.has(connection)) {
      fail(connection, 'this connection has already joined a session');
      return;
    }
    // Subscribe first so no streamed frame is missed between the snapshot and later updates.
    const subscription = await pubsub.subscribe(
      streamChannel(message.room, message.game),
      (frame) => connection.send(frame),
    );
    // Also subscribe to this device's OWN private channel (spec 0052), so a targeted hidden-info
    // `private` frame the engine publishes reaches only this player's connection. Subscribing before
    // the join means a payload dealt during join is not missed; the join catch-up also replays the
    // current one for a reconnect that subscribes after the deal. If this second subscribe fails, the
    // broadcast subscription above is already live and would leak (a dangling Redis channel listener),
    // so unwind it before bailing.
    let privateSubscription: Subscription;
    try {
      privateSubscription = await pubsub.subscribe(
        privateChannel(message.room, message.game, message.player),
        (frame) => connection.send(frame),
      );
    } catch (error) {
      await subscription.unsubscribe();
      fail(connection, error instanceof Error ? error.message : 'join failed');
      return;
    }
    bindings.set(connection, {
      room: message.room,
      game: message.game,
      player: message.player,
      subscription,
      privateSubscription,
    });
    try {
      // The engine returns the ordered catch-up frames (prompt/reveal/leaderboard/state) this
      // device needs to render the current phase, since pub/sub only carries frames sent after it
      // subscribed. Forward them in order.
      const frames = await engine.join(
        message.room,
        message.game,
        message.player,
        message.nickname,
      );
      for (const frame of frames) connection.send(frame);
    } catch (error) {
      await subscription.unsubscribe();
      await privateSubscription.unsubscribe();
      bindings.delete(connection);
      fail(connection, error instanceof Error ? error.message : 'join failed');
    }
  };

  const handle = async (connection: SocketConnection, message: ClientMessage) => {
    if (message.type === 'join') {
      await handleJoin(connection, message);
      return;
    }
    const bound = bindings.get(connection);
    // move/vote require a prior join to the same session.
    if (!bound || bound.room !== message.room || bound.game !== message.game) {
      fail(connection, 'join a session before sending moves or votes');
      return;
    }
    if (message.player !== bound.player) {
      fail(connection, 'cannot act on behalf of another player');
      return;
    }
    if (message.type === 'move') {
      // The engine may refuse this one submission (a duplicate or the correct answer in a bluffing
      // game); if so it hands back a targeted frame we send to this device alone - never a broadcast.
      const result = await engine.submitMove(
        bound.room,
        bound.game,
        bound.player,
        message.round,
        message.move,
      );
      if (result.reject) connection.send(result.reject);
    } else {
      await engine.submitVote(
        bound.room,
        bound.game,
        bound.player,
        message.round,
        message.target,
        message.agree,
      );
    }
  };

  const cleanup = (connection: SocketConnection) => {
    const bound = bindings.get(connection);
    if (!bound) return;
    bindings.delete(connection);
    void bound.subscription.unsubscribe();
    void bound.privateSubscription.unsubscribe();
    void engine.disconnect(bound.room, bound.game, bound.player);
  };

  return createWsServer(server, {
    onMessage: (connection, message) => {
      if (message.type === 'echo') {
        connection.send(message);
        return;
      }
      void handle(connection, message).catch((error) => {
        fail(connection, error instanceof Error ? error.message : 'internal error');
      });
    },
    onClose: cleanup,
    onError: (connection) => cleanup(connection),
  });
}
