import Fastify, { type FastifyInstance } from 'fastify';

/** Injected liveness probe so the app is testable without a real Redis. */
export interface HealthChecks {
  checkRedis(): Promise<boolean>;
}

/**
 * Build the game-engine HTTP app. `/health` reports whether the service can reach Redis (where
 * live session state lives) and returns 503 if it is down.
 */
export function createApp(checks: HealthChecks): FastifyInstance {
  const app = Fastify();

  app.get('/health', async (_request, reply) => {
    const redis = await checks.checkRedis();
    return reply.code(redis ? 200 : 503).send({
      status: redis ? 'ok' : 'degraded',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  return app;
}
