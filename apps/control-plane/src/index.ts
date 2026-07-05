import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPostgresPool, pingPostgres } from './db';

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

  const shutdown = (signal: string) => {
    console.log(`[control-plane] ${signal} received, shutting down`);
    void Promise.allSettled([app.close(), pool.end(), redis.quit()]).then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Bind 0.0.0.0 so the service is reachable from outside its container.
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[control-plane] listening on :${config.port}`);
}

main().catch((error) => {
  console.error('[control-plane] failed to start', error);
  process.exitCode = 1;
});
