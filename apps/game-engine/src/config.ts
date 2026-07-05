export interface ServiceConfig {
  port: number;
  redisUrl: string;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`missing required environment variable: ${key}`);
  }
  return value;
}

/** Read service config from the environment. `REDIS_URL` is required with no default. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return {
    port: Number(env.PORT ?? 4001),
    redisUrl: requireEnv(env, 'REDIS_URL'),
  };
}
