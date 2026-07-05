import Fastify, { type FastifyInstance } from 'fastify';

/** Injected liveness probes so the app is testable without real Postgres or Redis. */
export interface HealthChecks {
  checkPostgres(): Promise<boolean>;
  checkRedis(): Promise<boolean>;
}

/**
 * Build the control-plane HTTP app. `/health` reports whether the service can reach both
 * Postgres and Redis, and returns 503 if either is down so orchestrators see it as unhealthy.
 */
export function createApp(checks: HealthChecks): FastifyInstance {
  const app = Fastify();

  app.get('/health', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([checks.checkPostgres(), checks.checkRedis()]);
    const ok = postgres && redis;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      postgres: postgres ? 'ok' : 'unreachable',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  return app;
}
