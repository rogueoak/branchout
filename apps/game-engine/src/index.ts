import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import { createApp } from './app';
import { loadConfig } from './config';
import { attachGameSocket } from './socket';

async function main(): Promise<void> {
  const config = loadConfig();
  const redis = createRedisClient(config.redisUrl);
  redis.on('error', (error) => console.error('[game-engine] redis error', error));

  // Connect, but stay up if Redis is down: /health reports it and the client reconnects.
  await redis
    .connect()
    .catch((error) => console.error('[game-engine] redis connect failed', error));

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const cache = await pingRedis(redis);
  console.log(`[game-engine] startup check redis=${cache ? 'ok' : 'unreachable'}`);

  const app = createApp({ checkRedis: () => pingRedis(redis) });

  // Mount the WebSocket endpoint on Fastify's underlying HTTP server via the transport-agnostic
  // adapter in @branchout/protocol. Fastify does not handle the HTTP `upgrade` event itself, so
  // the adapter owns it cleanly; this keeps realtime behind the same swappable interface.
  const sockets = attachGameSocket(app.server);

  const shutdown = (signal: string) => {
    console.log(`[game-engine] ${signal} received, shutting down`);
    void Promise.allSettled([sockets.close(), app.close(), redis.quit()]).then(() =>
      process.exit(0),
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
