import { createApp } from './app';
import { loadConfig } from './config';
import { createPostgresPool, pingPostgres } from './db';
import { createRedisClient, pingRedis } from './redis';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPostgresPool(config.databaseUrl);
  const redis = createRedisClient(config.redisUrl);
  redis.on('error', (error) => console.error('[control-plane] redis error', error));

  // Connect, but stay up if Redis is down: /health reports it and the client reconnects. This
  // keeps the startup check consistent - neither dependency being down aborts boot.
  await redis
    .connect()
    .catch((error) => console.error('[control-plane] redis connect failed', error));

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const [postgres, cache] = await Promise.all([pingPostgres(pool), pingRedis(redis)]);
  console.log(
    `[control-plane] startup check postgres=${postgres ? 'ok' : 'unreachable'} redis=${
      cache ? 'ok' : 'unreachable'
    }`,
  );

  const app = createApp({
    checkPostgres: () => pingPostgres(pool),
    checkRedis: () => pingRedis(redis),
  });

  const server = app.listen(config.port, () =>
    console.log(`[control-plane] listening on :${config.port}`),
  );

  const shutdown = (signal: string) => {
    console.log(`[control-plane] ${signal} received, shutting down`);
    server.close(() => {
      void Promise.allSettled([pool.end(), redis.quit()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[control-plane] failed to start', error);
  process.exitCode = 1;
});
