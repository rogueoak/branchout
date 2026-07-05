// Streaming fan-out. The engine publishes server frames to a per-session channel; each connected
// device subscribes to its session's channel and forwards frames to its socket. Redis pub/sub
// carries the fan-out in production (architecture.md) so it works across engine instances; the
// in-memory implementation serves tests and single-process dev behind the same interface.

import type { RedisClientType } from 'redis';
import type { ServerMessage } from '@branchout/protocol';

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface PubSub {
  publish(channel: string, message: ServerMessage): Promise<void>;
  subscribe(channel: string, handler: (message: ServerMessage) => void): Promise<Subscription>;
}

/** Channel a session streams on. */
export function streamChannel(room: string, game: string): string {
  return `stream:${room}:${game}`;
}

/**
 * Redis pub/sub. `redis` requires a dedicated connection for subscriptions, so this takes a
 * subscriber client (typically `client.duplicate()`) separate from the publisher client.
 */
export class RedisPubSub implements PubSub {
  constructor(
    private readonly publisher: RedisClientType,
    private readonly subscriber: RedisClientType,
  ) {}

  async publish(channel: string, message: ServerMessage): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(
    channel: string,
    handler: (message: ServerMessage) => void,
  ): Promise<Subscription> {
    const listener = (raw: string) => handler(JSON.parse(raw) as ServerMessage);
    await this.subscriber.subscribe(channel, listener);
    return {
      unsubscribe: async () => {
        await this.subscriber.unsubscribe(channel, listener);
      },
    };
  }
}

/** In-memory pub/sub for tests and single-process dev. */
export class InMemoryPubSub implements PubSub {
  private readonly channels = new Map<string, Set<(message: ServerMessage) => void>>();

  async publish(channel: string, message: ServerMessage): Promise<void> {
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    // Clone through JSON so subscribers cannot mutate the publisher's object, matching Redis.
    for (const handler of [...handlers]) {
      handler(JSON.parse(JSON.stringify(message)) as ServerMessage);
    }
  }

  async subscribe(
    channel: string,
    handler: (message: ServerMessage) => void,
  ): Promise<Subscription> {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
    }
    handlers.add(handler);
    return {
      unsubscribe: async () => {
        handlers.delete(handler);
        if (handlers.size === 0) this.channels.delete(channel);
      },
    };
  }
}
