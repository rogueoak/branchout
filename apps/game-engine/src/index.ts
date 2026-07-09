import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import type { RedisClientType } from 'redis';
import { createApp } from './app';
import { loadConfig } from './config';
import { GameEngine } from './engine';
import { RedisPubSub } from './pubsub';
import { HttpControlPlaneReporter, NoopReporter, type ControlPlaneReporter } from './reporter';
import { RedisSessionStore } from './session';
import { attachGameSocket } from './socket';
import { createGameServices } from './services';
import { registerPlugins } from './plugins';
import { triviaPlugin } from '@branchout/game-trivia';
import { liarLiarPlugin } from '@branchout/game-liar-liar';

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

  // The plugin runtime: build the injected services, then instantiate each game plugin into the
  // registry. Adding a game is adding its plugin to this list. A plugin's `create()` may load its
  // data (e.g. the Trivia bank); a failure aborts boot via main().catch rather than serving a
  // broken game.
  const services = createGameServices();
  const { registry, configSchemas } = await registerPlugins(
    [triviaPlugin, liarLiarPlugin],
    services,
  );
  console.log(`[game-engine] registered games: ${registry.ids().join(', ')}`);

  const reporter: ControlPlaneReporter = config.controlPlaneUrl
    ? new HttpControlPlaneReporter({ baseUrl: config.controlPlaneUrl })
    : new NoopReporter();
  if (!config.controlPlaneUrl) {
    console.warn('[game-engine] CONTROL_PLANE_URL unset; round/complete reports are dropped');
  }

  const pubsub = new RedisPubSub(redis, subscriber);
  const engine = new GameEngine({
    registry,
    configSchemas,
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
