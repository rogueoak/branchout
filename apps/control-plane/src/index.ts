import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import { createHasher } from './accounts/hasher';
import { runMigrations } from './accounts/migrations';
import { PostgresAccountRepository } from './accounts/repository';
import { AccountService } from './accounts/service';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPostgresPool, pingPostgres } from './db';
import { RedisSessionStore, type SessionRedis } from './sessions/store';

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

  // Bring the schema up to date on boot so `docker compose up` needs no separate step.
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length > 0
        ? `[control-plane] applied migrations ${applied.join(', ')}`
        : '[control-plane] schema up to date',
    );
  } catch (error) {
    console.error('[control-plane] migration failed', error);
  }

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const [postgres, cache] = await Promise.all([pingPostgres(pool), pingRedis(redis)]);
  console.log(
    `[control-plane] startup check postgres=${postgres ? 'ok' : 'unreachable'} redis=${
      cache ? 'ok' : 'unreachable'
    }`,
  );

  const hasher = await createHasher();
  const accounts = new AccountService(new PostgresAccountRepository(pool), hasher);
  // Adapt the redis client to the narrow surface the session store needs.
  const sessionRedis: SessionRedis = {
    set: (key, value, options) => redis.set(key, value, options),
    get: (key) => redis.get(key),
    del: (key) => redis.del(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
  const sessions = new RedisSessionStore(sessionRedis, config.cookie.ttlSeconds);

  const app = createApp({
    checks: {
      checkPostgres: () => pingPostgres(pool),
      checkRedis: () => pingRedis(redis),
    },
    accounts,
    sessions,
    cookie: config.cookie,
    webOrigins: config.webOrigins,
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
