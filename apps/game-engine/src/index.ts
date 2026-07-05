import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createRedisClient, pingRedis } from './redis';
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
  const server = createServer(app);
  const sockets = attachGameSocket(server);

  server.listen(config.port, () =>
    console.log(`[game-engine] listening on :${config.port} (http + ws)`),
  );

  const shutdown = (signal: string) => {
    console.log(`[game-engine] ${signal} received, shutting down`);
    void Promise.allSettled([sockets.close(), redis.quit()]).then(() => {
      server.close(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[game-engine] failed to start', error);
  process.exitCode = 1;
});
