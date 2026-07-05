import { requireEnv } from '@branchout/service-runtime';

export interface ServiceConfig {
  port: number;
  redisUrl: string;
}

/** Read service config from the environment. `REDIS_URL` is required with no default. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return {
    port: Number(env.PORT ?? 4001),
    redisUrl: requireEnv(env, 'REDIS_URL'),
  };
}
