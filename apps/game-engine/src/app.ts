import express, { type Express } from 'express';

/** Injected liveness probe so the app is testable without a real Redis. */
export interface HealthChecks {
  checkRedis(): Promise<boolean>;
}

/**
 * Build the game-engine HTTP app. `/health` reports whether the service can reach Redis (where
 * live session state lives) and returns 503 if it is down.
 */
export function createApp(checks: HealthChecks): Express {
  const app = express();

  app.get('/health', async (_req, res) => {
    const redis = await checks.checkRedis();
    res.status(redis ? 200 : 503).json({
      status: redis ? 'ok' : 'degraded',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  return app;
}
