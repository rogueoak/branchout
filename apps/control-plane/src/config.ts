import { requireEnv } from '@branchout/service-runtime';

export interface SessionCookieConfig {
  /** Cookie name that carries the opaque session id. */
  name: string;
  /** Send only over HTTPS. True in production; can be relaxed for local http via COOKIE_SECURE. */
  secure: boolean;
  /** SameSite policy. `lax` sends the cookie on same-site requests, including localhost ports. */
  sameSite: 'lax' | 'strict' | 'none';
  /**
   * Cookie Domain attribute. Unset (the default) makes the cookie host-only. Set to a parent domain
   * (e.g. `.branchout.games`) so one session spans the apex and its subdomains - the insider surface
   * needs this (spec 0035). Left unset in local/dev where every surface shares one host.
   */
  domain?: string;
  /** Session lifetime and sliding-expiry window, in seconds. */
  ttlSeconds: number;
}

/**
 * Auth rate-limiting / lockout thresholds (spec 0036). Sign-in locks per (account, IP) so brute
 * force is bounded even when the IP rotates; sign-up caps per IP to blunt mass account creation.
 */
export interface RateLimitConfig {
  /** Failed sign-ins per (account, IP) within the window before a 429 lockout. */
  loginMaxAttempts: number;
  /** Fixed-window length for the sign-in lockout, in seconds. */
  loginWindowSeconds: number;
  /** Sign-ups per client IP within the window before a 429. */
  signupMaxPerIp: number;
  /** Fixed-window length for the sign-up cap, in seconds. */
  signupWindowSeconds: number;
}

/**
 * Host in-game feedback config (spec 0048). The Resend API key is optional: unset means feedback
 * email is not configured yet (the endpoint returns a clear 503, never crashes), so the code ships
 * before the secret does. The per-IP cap reuses the spec 0036 limiter to blunt inbox flooding.
 */
export interface FeedbackConfig {
  /** Resend API key. Unset -> the endpoint replies "not configured" and sends nothing. */
  resendApiKey?: string;
  /** Feedback submissions per client IP within the window before a 429. */
  maxPerIp: number;
  /** Fixed-window length for the per-IP cap, in seconds. */
  windowSeconds: number;
}

/** The per-IP rate-limit knobs the feedback route consumes (the subset it needs from FeedbackConfig). */
export interface FeedbackRateLimitConfig {
  maxPerIp: number;
  windowSeconds: number;
}

/**
 * The admin session cookie (spec 0037). Deliberately its OWN cookie, distinct from the player
 * `SessionCookieConfig`: a different name and - critically - NO `domain`, so the admin session is
 * host-only to `admin.branchout.games` and never spans the apex/subdomains the player cookie does.
 */
export interface AdminCookieConfig {
  name: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  ttlSeconds: number;
}

/**
 * Newsletter subscribe / Constant Contact config (spec 0047). The three `ctct*` credentials are each
 * OPTIONAL: the endpoint ships inert and returns a clear "not configured" response when any is unset,
 * so it never crashes before an operator provisions the secrets (mint the refresh token via `ctct
 * login`; find the "Branch Out" list id via `ctct list list --name "Branch Out"`). The two rate-limit
 * knobs cap subscribe attempts per client IP.
 */
export interface SubscribeConfig {
  ctctClientId?: string;
  ctctRefreshToken?: string;
  ctctListId?: string;
  /** Subscribe attempts per client IP within the window before a 429. */
  maxPerIp: number;
  /** Fixed-window length for the per-IP subscribe cap, in seconds. */
  windowSeconds: number;
}

export interface ServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Browser origins allowed to call the API with credentials (the web app). */
  webOrigins: string[];
  cookie: SessionCookieConfig;
  /** The host-only admin session cookie (spec 0037). */
  adminCookie: AdminCookieConfig;
  /** Env-seeded root admin, reconciled on boot; the console has no public admin signup (spec 0037). */
  adminRootEmail?: string;
  adminRootPassword?: string;
  /** Base URL of the game engine's internal REST API for the start handoff + host controls. */
  engineUrl: string;
  /** Shared secret the engine presents on the report intake; unset only in trusted dev. */
  internalToken?: string;
  /**
   * Shared HMAC secret for engine-join authentication (spec 0064). The control-plane mints a
   * short-lived token over the caller's OWN membership at `GET /rooms/:code/engine-token`; the
   * engine verifies it on the WebSocket join. Same value on both services. Unset only in pure-unit
   * tests / trusted dev, where the endpoint returns a 503 "not configured" and the engine skips
   * enforcement.
   */
  engineAuthSecret?: string;
  /** TTL for live room membership/presence in Redis; refreshed on each write. */
  membershipTtlSeconds: number;
  /** Auth rate-limiting / lockout thresholds. */
  rateLimit: RateLimitConfig;
  /** Host in-game feedback (spec 0048): Resend key + per-IP cap. */
  feedback: FeedbackConfig;
  /** Newsletter subscribe / Constant Contact config (spec 0047). */
  subscribe: SubscribeConfig;
}

/** One week, in seconds - the default session lifetime. */
const DEFAULT_SESSION_TTL = 60 * 60 * 24 * 7;

/** Twelve hours - the default lifetime for a room's idle live membership in Redis. */
const DEFAULT_MEMBERSHIP_TTL = 60 * 60 * 12;

/** Eight hours - the default admin session lifetime (shorter than a player's week; operator sessions). */
const DEFAULT_ADMIN_SESSION_TTL = 60 * 60 * 8;

/** Auth rate-limit defaults: 5 sign-in tries / 15 min; 10 sign-ups / hour per IP. */
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW = 60 * 15;
const DEFAULT_SIGNUP_MAX_PER_IP = 10;
const DEFAULT_SIGNUP_WINDOW = 60 * 60;

/** Feedback per-IP defaults: 5 submissions / 10 minutes (spec 0048). */
const DEFAULT_FEEDBACK_MAX_PER_IP = 5;
const DEFAULT_FEEDBACK_WINDOW = 60 * 10;

/** Subscribe rate-limit defaults (spec 0047): 5 subscribes / 10 min per IP. */
const DEFAULT_SUBSCRIBE_MAX_PER_IP = 5;
const DEFAULT_SUBSCRIBE_WINDOW = 60 * 10;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true' || value === '1';
}

/**
 * A positive integer from the environment, else the fallback. Guards the rate-limit knobs: a garbage
 * value would otherwise become `NaN`, and a `NaN` limit makes `count < NaN` false -> everyone is
 * instantly locked out. Zero/negative are rejected too (a limit must be at least 1).
 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
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
      // Omit the key entirely when unset so the cookie stays host-only (no `domain: undefined`).
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      ttlSeconds: Number(env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL),
    },
    adminCookie: {
      name: env.ADMIN_SESSION_COOKIE_NAME ?? 'branchout_admin_session',
      secure: parseBool(env.COOKIE_SECURE, true),
      sameSite: parseSameSite(env.ADMIN_COOKIE_SAMESITE),
      // Deliberately NO domain - the admin cookie is always host-only to admin.branchout.games.
      ttlSeconds: Number(env.ADMIN_SESSION_TTL_SECONDS ?? DEFAULT_ADMIN_SESSION_TTL),
    },
    ...(env.ADMIN_ROOT_EMAIL ? { adminRootEmail: env.ADMIN_ROOT_EMAIL } : {}),
    ...(env.ADMIN_ROOT_PASSWORD ? { adminRootPassword: env.ADMIN_ROOT_PASSWORD } : {}),
    engineUrl: env.ENGINE_URL ?? 'http://localhost:4001',
    ...(env.INTERNAL_API_TOKEN ? { internalToken: env.INTERNAL_API_TOKEN } : {}),
    ...(env.ENGINE_AUTH_SECRET ? { engineAuthSecret: env.ENGINE_AUTH_SECRET } : {}),
    membershipTtlSeconds: Number(env.MEMBERSHIP_TTL_SECONDS ?? DEFAULT_MEMBERSHIP_TTL),
    rateLimit: {
      loginMaxAttempts: parsePositiveInt(env.LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS),
      loginWindowSeconds: parsePositiveInt(env.LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW),
      signupMaxPerIp: parsePositiveInt(env.SIGNUP_MAX_PER_IP, DEFAULT_SIGNUP_MAX_PER_IP),
      signupWindowSeconds: parsePositiveInt(env.SIGNUP_WINDOW_SECONDS, DEFAULT_SIGNUP_WINDOW),
    },
    feedback: {
      // Omit the key entirely when unset so nothing downstream sees `resendApiKey: undefined` as
      // "configured with an empty value" - unset means feedback email is not configured yet.
      ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
      maxPerIp: parsePositiveInt(env.FEEDBACK_MAX_PER_IP, DEFAULT_FEEDBACK_MAX_PER_IP),
      windowSeconds: parsePositiveInt(env.FEEDBACK_WINDOW_SECONDS, DEFAULT_FEEDBACK_WINDOW),
    },
    subscribe: {
      // Each credential is optional so a missing one is detectable at the route (a clear
      // "not configured" 503), never a boot-time throw. Omit the key entirely when unset so a
      // `?.` read stays undefined rather than an empty string.
      ...(env.CTCT_CLIENT_ID ? { ctctClientId: env.CTCT_CLIENT_ID } : {}),
      ...(env.CTCT_REFRESH_TOKEN ? { ctctRefreshToken: env.CTCT_REFRESH_TOKEN } : {}),
      ...(env.CTCT_LIST_ID ? { ctctListId: env.CTCT_LIST_ID } : {}),
      maxPerIp: parsePositiveInt(env.SUBSCRIBE_MAX_PER_IP, DEFAULT_SUBSCRIBE_MAX_PER_IP),
      windowSeconds: parsePositiveInt(env.SUBSCRIBE_WINDOW_SECONDS, DEFAULT_SUBSCRIBE_WINDOW),
    },
  };
}
