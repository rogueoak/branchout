import express, { type Express } from 'express';

/** Injected liveness probes so the app is testable without real Postgres or Redis. */
export interface HealthChecks {
  checkPostgres(): Promise<boolean>;
  checkRedis(): Promise<boolean>;
}

/**
 * Build the control-plane HTTP app. `/health` reports whether the service can reach both
 * Postgres and Redis, and returns 503 if either is down so orchestrators see it as unhealthy.
 */
export function createApp(checks: HealthChecks): Express {
  const app = express();

  app.get('/health', async (_req, res) => {
    const [postgres, redis] = await Promise.all([checks.checkPostgres(), checks.checkRedis()]);
    const ok = postgres && redis;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      postgres: postgres ? 'ok' : 'unreachable',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  return app;
}
