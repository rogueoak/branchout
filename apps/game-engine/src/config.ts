import { requireEnv } from '@branchout/service-runtime';

/**
 * Parse a positive-integer env var, falling back to `fallback` when unset, non-numeric, or <= 0.
 * Guards the worker cap/timeout against a fail-open misconfig (e.g. `GAME_WORKER_MAX=abc` -> NaN ->
 * `size >= NaN` is always false -> the cap silently disables). A bad value warns and uses the default.
 */
function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[game-engine] ignoring invalid config value "${raw}"; using ${fallback}`);
    return fallback;
  }
  return Math.floor(n);
}

export interface ServiceConfig {
  port: number;
  redisUrl: string;
  /** Base URL of the control-plane for round + game-complete reports. Optional in dev. */
  controlPlaneUrl?: string;
  /** Max concurrent game workers (spec 0045); a session over this is refused at start. */
  workerMax: number;
  /** Per-call worker timeout in ms (spec 0045); a call/init past this kills the worker as hung. */
  workerCallTimeoutMs: number;
  /**
   * Shared HMAC secret the engine uses to verify a join token (spec 0064). When set, the WebSocket
   * `join` REQUIRES a valid token that binds the connecting device to its claimed player, so a
   * device cannot impersonate another player and read their private payloads. Present on the
   * control-plane (which mints) and the engine (which verifies) in dev/e2e/prod; left unset only in
   * pure-unit tests that never exercise the auth path.
   */
  engineAuthSecret?: string;
}

/** Read service config from the environment. `REDIS_URL` is required with no default. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const controlPlaneUrl = env.CONTROL_PLANE_URL;
  return {
    port: Number(env.PORT ?? 4001),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    ...(controlPlaneUrl ? { controlPlaneUrl } : {}),
    // A generous default cap: one worker per concurrent room+game. Tune down under memory pressure.
    workerMax: positiveIntEnv(env.GAME_WORKER_MAX, 64),
    // 2s covers a slow module build (Trivia loads ~1600 questions) and a fat physics tick with wide
    // headroom over the 40ms cadence, while still killing a truly wedged worker within a beat.
    workerCallTimeoutMs: positiveIntEnv(env.GAME_WORKER_CALL_TIMEOUT_MS, 2000),
    ...(env.ENGINE_AUTH_SECRET ? { engineAuthSecret: env.ENGINE_AUTH_SECRET } : {}),
  };
}
