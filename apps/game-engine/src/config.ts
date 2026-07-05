import { requireEnv } from '@branchout/service-runtime';

export interface ServiceConfig {
  port: number;
  redisUrl: string;
  /** Base URL of the control-plane for round + game-complete reports. Optional in dev. */
  controlPlaneUrl?: string;
}

/** Read service config from the environment. `REDIS_URL` is required with no default. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const controlPlaneUrl = env.CONTROL_PLANE_URL;
  return {
    port: Number(env.PORT ?? 4001),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
  };
}
