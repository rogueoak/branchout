import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import type { RedisClientType } from 'redis';
import { createApp } from './app';
import { loadConfig } from './config';
import { GameEngine } from './engine';
import { RedisPubSub } from './pubsub';
import { GameRegistry } from './registry';
import { HttpControlPlaneReporter, NoopReporter, type ControlPlaneReporter } from './reporter';
import { RedisSessionStore } from './session';
import { attachGameSocket } from './socket';
import { stubGame } from './stub-game';

async function main(): Promise<void> {
  const config = loadConfig();
  const redis = createRedisClient(config.redisUrl);
  redis.on('error', (error) => console.error('[game-engine] redis error', error));

  // Pub/sub needs a connection dedicated to subscriptions, so duplicate the client.
  const subscriber = redis.duplicate() as RedisClientType;
  subscriber.on('error', (error) => console.error('[game-engine] redis sub error', error));

  // Connect, but stay up if Redis is down: /health reports it and the client reconnects.
  await Promise.allSettled([redis.connect(), subscriber.connect()]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[game-engine] redis connect failed', result.reason);
      }
    }
  });

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const cache = await pingRedis(redis);
  console.log(`[game-engine] startup check redis=${cache ? 'ok' : 'unreachable'}`);

  // The modular game registry. Adding a game is registering its module here.
  const registry = new GameRegistry([stubGame]);

  const reporter: ControlPlaneReporter = config.controlPlaneUrl
    ? new HttpControlPlaneReporter({ baseUrl: config.controlPlaneUrl })
    : new NoopReporter();
  if (!config.controlPlaneUrl) {
    console.warn('[game-engine] CONTROL_PLANE_URL unset; round/complete reports are dropped');
  }

  const pubsub = new RedisPubSub(redis, subscriber);
  const engine = new GameEngine({
    registry,
    store: new RedisSessionStore(redis),
    pubsub,
    reporter,
  });

  const app = createApp({ checkRedis: () => pingRedis(redis) }, engine);

  // Mount the WebSocket endpoint on Fastify's underlying HTTP server via the transport-agnostic
  // adapter in @branchout/protocol. Fastify does not handle the HTTP `upgrade` event itself, so
  // the adapter owns it cleanly; this keeps realtime behind the same swappable interface.
  const sockets = attachGameSocket(app.server, engine, pubsub);

  const shutdown = (signal: string) => {
    console.log(`[game-engine] ${signal} received, shutting down`);
    void Promise.allSettled([sockets.close(), app.close(), redis.quit(), subscriber.quit()]).then(
      () => process.exit(0),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Bind 0.0.0.0 so the service is reachable from outside its container.
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[game-engine] listening on :${config.port} (http + ws)`);
}

main().catch((error) => {
  console.error('[game-engine] failed to start', error);
  process.exitCode = 1;
});
