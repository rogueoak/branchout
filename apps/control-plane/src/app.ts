import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { V1_PREFIX } from '@branchout/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AccountService } from './accounts/service';
import type { SessionCookieConfig } from './config';
import { registerAuthRoutes } from './routes/auth';
import { registerEngineRoutes } from './routes/engine';
import { registerProfileRoutes } from './routes/profiles';
import { registerRoomRoutes } from './routes/rooms';
import type { ProfileService } from './profiles/service';
import type { RoomService } from './rooms/service';
import type { SessionStore } from './sessions/store';

/** Injected liveness probes so the app is testable without real Postgres or Redis. */
export interface HealthChecks {
  checkPostgres(): Promise<boolean>;
  checkRedis(): Promise<boolean>;
}

export interface AppDeps {
  checks: HealthChecks;
  accounts: AccountService;
  profiles: ProfileService;
  sessions: SessionStore;
  rooms: RoomService;
  cookie: SessionCookieConfig;
  /** Browser origins allowed to call the API with credentials. */
  webOrigins: string[];
  /** Shared secret the engine presents on the report intake; left unset only in trusted dev. */
  internalToken?: string;
}

/**
 * Build the control-plane HTTP app: an unversioned `/health` probe plus every functional API under
 * the `/v1` prefix (spec 0033). Cookies are parsed by `@fastify/cookie`; cross-origin browser calls
 * from the web app are allowed with credentials by `@fastify/cors`, restricted to the configured
 * origins (never wildcard, because credentialed CORS with `*` is unsafe and browsers reject it
 * anyway). CORS and cookie plugins register at the root, so the `/v1` child context inherits them.
 */
export function createApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  app.register(cors, {
    origin: deps.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  app.register(cookie);

  // Operational liveness probe - stays at the root, unversioned: orchestration (compose `--wait`,
  // the Caddy edge, uptime monitors) keys on a stable URL and it carries no API contract to version.
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

  // Every functional API lives under `/v1`. Mounting the route groups in one prefixed child context
  // keeps the individual route modules path-relative and version-agnostic; a future `/v2` is a
  // second mount, not a rewrite of every route string.
  app.register(
    (v1, _opts, done) => {
      registerAuthRoutes(v1, {
        accounts: deps.accounts,
        sessions: deps.sessions,
        cookie: deps.cookie,
      });

      registerRoomRoutes(v1, {
        rooms: deps.rooms,
        sessions: deps.sessions,
        cookie: deps.cookie,
      });

      registerProfileRoutes(v1, { profiles: deps.profiles });

      registerEngineRoutes(v1, {
        rooms: deps.rooms,
        internalToken: deps.internalToken,
      });

      done();
    },
    { prefix: V1_PREFIX },
  );

  return app;
}
