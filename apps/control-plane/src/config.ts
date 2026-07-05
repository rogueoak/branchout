import { requireEnv } from '@branchout/service-runtime';

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

/**
 * Read service config from the environment. Connection strings are required with no default -
 * fail fast rather than silently point at localhost in production.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
  };
}
