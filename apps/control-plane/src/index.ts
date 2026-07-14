import { createRedisClient, pingRedis } from '@branchout/service-runtime';
import { createHasher } from './accounts/hasher';
import { PostgresAccountRepository } from './accounts/repository';
import { AccountService } from './accounts/service';
import { PostgresAdminRepository } from './admin/repository';
import { AdminService } from './admin/service';
import { type AdminSessionRedis, RedisAdminSessionStore } from './admin/session';
import { createApp } from './app';
import { loadConfig } from './config';
import { CreditLedger } from './credits/ledger';
import { PostgresLedgerRepository } from './credits/repository';
import { FreeTierProvider } from './credits/tiers';
import { createPostgresPool, pingPostgres } from './db';
import { runMigrations } from './db/migrations';
import { allMigrations } from './migrations';
import { PostgresPlaysRepository } from './profiles/plays.postgres';
import { ProfileService } from './profiles/service';
import { RedisRateLimiter, type RateLimitRedis } from './ratelimit/limiter';
import { HttpEngineClient } from './rooms/engine-client';
import { RedisMembershipStore, type MembershipRedis } from './rooms/membership.redis';
import { PostgresRoomRepository } from './rooms/repository';
import { RoomService } from './rooms/service';
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

  // Bring the schema up to date on boot so `docker compose up` needs no separate step. Fail
  // fast on error: a missing or partial schema will not self-heal, and starting anyway would
  // 500 every signup/login while /health (a connectivity check) still reports Postgres ok.
  try {
    const applied = await runMigrations(pool, allMigrations);
    console.log(
      applied.length > 0
        ? `[control-plane] applied migrations ${applied.join(', ')}`
        : '[control-plane] schema up to date',
    );
  } catch (error) {
    console.error('[control-plane] migration failed, aborting boot', error);
    throw error;
  }

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const [postgres, cache] = await Promise.all([pingPostgres(pool), pingRedis(redis)]);
  console.log(
    `[control-plane] startup check postgres=${postgres ? 'ok' : 'unreachable'} redis=${
      cache ? 'ok' : 'unreachable'
    }`,
  );

  const hasher = await createHasher();
  const accountRepo = new PostgresAccountRepository(pool);
  const accounts = new AccountService(accountRepo, hasher);
  // Adapt the redis client to the narrow surface the session store needs.
  const sessionRedis: SessionRedis = {
    set: (key, value, options) => redis.set(key, value, options),
    get: (key) => redis.get(key),
    del: (key) => redis.del(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
  const sessions = new RedisSessionStore(sessionRedis, config.cookie.ttlSeconds);

  // Separate admin identity (spec 0037): its own store + Redis session namespace, never the player
  // pool/cookie. Reconcile the env-seeded root admin on boot (env is the source of truth for its
  // password - a break-glass recovery); there is no public admin signup.
  const admins = new AdminService(new PostgresAdminRepository(pool), hasher);
  const adminSessionRedis: AdminSessionRedis = {
    set: (key, value, options) => redis.set(key, value, options),
    get: (key) => redis.get(key),
    del: (key) => redis.del(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
  const adminSessions = new RedisAdminSessionStore(
    adminSessionRedis,
    config.adminCookie.ttlSeconds,
  );
  try {
    await admins.ensureRootAdmin(config.adminRootEmail, config.adminRootPassword);
    if (config.adminRootEmail) {
      console.log('[control-plane] root admin reconciled');
    }
  } catch (error) {
    console.error('[control-plane] root admin bootstrap failed, aborting boot', error);
    throw error;
  }

  // Live room membership/presence in Redis; durable room + history and the credit ledger in
  // Postgres. Tiers default to Free until the Purchases spec adds real subscriptions.
  const membershipRedis: MembershipRedis = {
    hSet: (key, field, value) => redis.hSet(key, field, value),
    hGet: (key, field) => redis.hGet(key, field),
    hGetAll: (key) => redis.hGetAll(key),
    hDel: (key, field) => redis.hDel(key, field),
    sAdd: (key, member) => redis.sAdd(key, member),
    sIsMember: (key, member) => redis.sIsMember(key, member),
    del: (key) => redis.del(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
  const membership = new RedisMembershipStore(membershipRedis, config.membershipTtlSeconds);
  // Auth rate-limiting / lockout counters in Redis (spec 0036).
  const rateLimitRedis: RateLimitRedis = {
    get: (key) => redis.get(key),
    incr: (key) => redis.incr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
    ttl: (key) => redis.ttl(key),
    del: (key) => redis.del(key),
  };
  const limiter = new RedisRateLimiter(rateLimitRedis);
  const ledger = new CreditLedger(new PostgresLedgerRepository(pool), new FreeTierProvider());
  const engine = new HttpEngineClient(config.engineUrl, config.internalToken);
  const plays = new PostgresPlaysRepository(pool);
  const rooms = new RoomService(
    new PostgresRoomRepository(pool),
    membership,
    ledger,
    engine,
    plays,
    accountRepo,
  );
  const profiles = new ProfileService(accounts, plays);

  const app = createApp({
    checks: {
      checkPostgres: () => pingPostgres(pool),
      checkRedis: () => pingRedis(redis),
    },
    accounts,
    profiles,
    sessions,
    rooms,
    cookie: config.cookie,
    admins,
    adminSessions,
    adminCookie: config.adminCookie,
    webOrigins: config.webOrigins,
    ...(config.internalToken ? { internalToken: config.internalToken } : {}),
    limiter,
    rateLimit: config.rateLimit,
    subscribe: config.subscribe,
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
