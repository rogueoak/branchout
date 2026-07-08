import type { Server as HttpServer } from 'node:http';
import type {
  ClientMessage,
  JoinMessage,
  SocketConnection,
  SocketServer,
} from '@branchout/protocol';
import { createWsServer } from '@branchout/protocol/ws';
import type { GameEngine } from './engine';
import { streamChannel, type PubSub, type Subscription } from './pubsub';

/** Per-connection binding: which session this device joined and its stream subscription. */
interface Bound {
  room: string;
  game: string;
  player: string;
  subscription: Subscription;
}

/**
 * Attach the realtime endpoint and route player frames to the engine. A device connects, sends a
 * `join`, and is bound to a room/game/player; the engine's streamed frames for that session are
 * forwarded to it via pub/sub. `answer` and `vote` frames are accepted only for the session the
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
    bindings.set(connection, {
      room: message.room,
      game: message.game,
      player: message.player,
      subscription,
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
    // answer/vote require a prior join to the same session.
    if (!bound || bound.room !== message.room || bound.game !== message.game) {
      fail(connection, 'join a session before sending answers or votes');
      return;
    }
    if (message.player !== bound.player) {
      fail(connection, 'cannot act on behalf of another player');
      return;
    }
    if (message.type === 'answer') {
      await engine.submitAnswer(
        bound.room,
        bound.game,
        bound.player,
        message.round,
        message.answer,
      );
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
