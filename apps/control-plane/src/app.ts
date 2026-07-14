import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { V1_PREFIX } from '@branchout/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AccountService } from './accounts/service';
import type { AdminService } from './admin/service';
import type { AdminSessionStore } from './admin/session';
import type {
  AdminCookieConfig,
  RateLimitConfig,
  SessionCookieConfig,
  SubscribeConfig,
} from './config';
import type { RateLimiter } from './ratelimit/limiter';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerEngineRoutes } from './routes/engine';
import { registerProfileRoutes } from './routes/profiles';
import { registerRoomRoutes } from './routes/rooms';
import { registerSubscribeRoutes } from './routes/subscribe';
import { createTokenCache, type TokenCache } from './subscribe/constant-contact';
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
  /** Separate admin identity (spec 0037): its own service, session store, and host-only cookie. */
  admins: AdminService;
  adminSessions: AdminSessionStore;
  adminCookie: AdminCookieConfig;
  /** Browser origins allowed to call the API with credentials. */
  webOrigins: string[];
  /** Shared secret the engine presents on the report intake; left unset only in trusted dev. */
  internalToken?: string;
  /** Rate limiter backing the auth-endpoint lockouts (spec 0036). */
  limiter: RateLimiter;
  /** Auth rate-limit thresholds. */
  rateLimit: RateLimitConfig;
  /** Newsletter subscribe / Constant Contact config (spec 0047). */
  subscribe: SubscribeConfig;
  /**
   * Module-scoped CTCT access-token cache for the subscribe endpoint (spec 0047). Optional so a
   * caller (or a test) need not supply one; `createApp` mints a fresh cache when it is absent.
   */
  subscribeTokenCache?: TokenCache;
  /** Injected fetch for the subscribe endpoint's CTCT calls (tests mock it); defaults to global fetch. */
  subscribeFetch?: typeof fetch;
}

/**
 * Build the control-plane HTTP app: an unversioned `/health` probe plus every functional API under
 * the `/v1` prefix (spec 0033). Cookies are parsed by `@fastify/cookie`; cross-origin browser calls
 * from the web app are allowed with credentials by `@fastify/cors`, restricted to the configured
 * origins (never wildcard, because credentialed CORS with `*` is unsafe and browsers reject it
 * anyway). CORS and cookie plugins register at the root, so the `/v1` child context inherits them.
 */
export function createApp(deps: AppDeps): FastifyInstance {
  // trustProxy: `request.ip` reads the `X-Forwarded-For` Caddy sets (without it, behind Caddy every
  // client would share the proxy's IP and one rate-limit bucket). This IP is trustworthy because the
  // Caddy edge REPLACES X-Forwarded-For with the true connection peer ({remote_host}) before proxying
  // (spec 0038), so a client cannot forge it - on the EDGE-FRONTED path. Two caveats: (1) it assumes
  // the droplet terminates TLS directly (no LB/proxy in front) - revisit the trusted hop if that
  // changes; (2) in dev the infra compose publishes this port with no Caddy, so request.ip is
  // unsanitized there - dev is not a trust boundary. The login lockout still anchors on the ACCOUNT
  // (defence-in-depth, correct even if the IP trust chain regresses); the per-IP sign-up cap now bites.
  const app = Fastify({ trustProxy: true });

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
        limiter: deps.limiter,
        rateLimit: deps.rateLimit,
      });

      registerRoomRoutes(v1, {
        rooms: deps.rooms,
        sessions: deps.sessions,
        cookie: deps.cookie,
      });

      registerProfileRoutes(v1, { profiles: deps.profiles });

      registerAdminRoutes(v1, {
        admins: deps.admins,
        adminSessions: deps.adminSessions,
        adminCookie: deps.adminCookie,
        accounts: deps.accounts,
        limiter: deps.limiter,
        rateLimit: deps.rateLimit,
      });

      registerEngineRoutes(v1, {
        rooms: deps.rooms,
        internalToken: deps.internalToken,
      });

      registerSubscribeRoutes(v1, {
        config: deps.subscribe,
        limiter: deps.limiter,
        // A module-scoped token cache so a CTCT access token is minted once and reused across requests
        // for the life of the process; a fresh one is created when the caller supplies none.
        tokenCache: deps.subscribeTokenCache ?? createTokenCache(),
        ...(deps.subscribeFetch ? { fetchImpl: deps.subscribeFetch } : {}),
      });

      done();
    },
    { prefix: V1_PREFIX },
  );

  return app;
}
