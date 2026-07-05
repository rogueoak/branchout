import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AccountService } from './accounts/service';
import type { SessionCookieConfig } from './config';
import { registerAuthRoutes } from './routes/auth';
import type { SessionStore } from './sessions/store';

/** Injected liveness probes so the app is testable without real Postgres or Redis. */
export interface HealthChecks {
  checkPostgres(): Promise<boolean>;
  checkRedis(): Promise<boolean>;
}

export interface AppDeps {
  checks: HealthChecks;
  accounts: AccountService;
  sessions: SessionStore;
  cookie: SessionCookieConfig;
  /** Browser origins allowed to call the API with credentials. */
  webOrigins: string[];
}

/**
 * Build the control-plane HTTP app: `/health` plus the account + session auth routes. Cookies
 * are parsed by `@fastify/cookie`; cross-origin browser calls from the web app are allowed
 * with credentials by `@fastify/cors`, restricted to the configured origins (never wildcard,
 * because credentialed CORS with `*` is unsafe and browsers reject it anyway).
 */
export function createApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  app.register(cors, {
    origin: deps.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH'],
  });
  app.register(cookie);

  app.get('/health', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([
      deps.checks.checkPostgres(),
      deps.checks.checkRedis(),
    ]);
    const ok = postgres && redis;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      postgres: postgres ? 'ok' : 'unreachable',
      redis: redis ? 'ok' : 'unreachable',
    });
  });

  registerAuthRoutes(app, {
    accounts: deps.accounts,
    sessions: deps.sessions,
    cookie: deps.cookie,
  });

  return app;
}
