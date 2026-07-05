import { requireEnv } from '@branchout/service-runtime';

export interface SessionCookieConfig {
  /** Cookie name that carries the opaque session id. */
  name: string;
  /** Send only over HTTPS. True in production; can be relaxed for local http via COOKIE_SECURE. */
  secure: boolean;
  /** SameSite policy. `lax` sends the cookie on same-site requests, including localhost ports. */
  sameSite: 'lax' | 'strict' | 'none';
  /** Session lifetime and sliding-expiry window, in seconds. */
  ttlSeconds: number;
}

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Browser origins allowed to call the API with credentials (the web app). */
  webOrigins: string[];
  cookie: SessionCookieConfig;
  /** Base URL of the game engine's internal REST API for the start handoff + host controls. */
  engineUrl: string;
  /** Shared secret the engine presents on the report intake; unset only in trusted dev. */
  internalToken?: string;
  /** TTL for live room membership/presence in Redis; refreshed on each write. */
  membershipTtlSeconds: number;
}

/** One week, in seconds - the default session lifetime. */
const DEFAULT_SESSION_TTL = 60 * 60 * 24 * 7;

/** Twelve hours - the default lifetime for a room's idle live membership in Redis. */
const DEFAULT_MEMBERSHIP_TTL = 60 * 60 * 12;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true' || value === '1';
}

/**
 * Parse the SameSite policy. `lax` is the safe default and works when web and control-plane
 * share a site (e.g. localhost:3000 -> :4000). A cross-site deploy (web and control-plane on
 * different registrable domains) needs `none` + secure for the session cookie to be sent.
 */
function parseSameSite(value: string | undefined): SessionCookieConfig['sameSite'] {
  if (value === 'strict' || value === 'none' || value === 'lax') {
    return value;
  }
  return 'lax';
}

/**
 * Read service config from the environment. Connection strings are required with no default -
 * fail fast rather than silently point at localhost in production. Cookie security defaults to
 * safe (secure + lax) and only relaxes when explicitly told to for local http development.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const webOrigins = (env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    webOrigins,
    cookie: {
      name: env.SESSION_COOKIE_NAME ?? 'branchout_session',
      secure: parseBool(env.COOKIE_SECURE, true),
      sameSite: parseSameSite(env.COOKIE_SAMESITE),
      ttlSeconds: Number(env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL),
    },
    engineUrl: env.ENGINE_URL ?? 'http://localhost:4001',
    ...(env.INTERNAL_API_TOKEN ? { internalToken: env.INTERNAL_API_TOKEN } : {}),
    membershipTtlSeconds: Number(env.MEMBERSHIP_TTL_SECONDS ?? DEFAULT_MEMBERSHIP_TTL),
  };
}
