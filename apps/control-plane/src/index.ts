import { createApp } from './app';
import { loadConfig } from './config';
import { createPostgresPool, pingPostgres } from './db';
import { createRedisClient, pingRedis } from './redis';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPostgresPool(config.databaseUrl);
  const redis = createRedisClient(config.redisUrl);
  redis.on('error', (error) => console.error('[control-plane] redis error', error));
  await redis.connect();

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

  app.listen(config.port, () => console.log(`[control-plane] listening on :${config.port}`));
}

main().catch((error) => {
  console.error('[control-plane] failed to start', error);
  process.exitCode = 1;
});
