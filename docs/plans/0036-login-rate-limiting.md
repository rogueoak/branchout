# Plan 0036 - Login rate limiting (sign-in + sign-up)

Source spec: `docs/specs/0036-login-rate-limiting.md`. Branch `feat/0036-login-rate-limiting`.
Independent of 0035; control-plane only (no Caddy/web changes).

## Design decisions (from exploration)

- **Custom Redis-backed limiter, not `@fastify/rate-limit`.** The spec preferred a library "where it
  fits", but login needs a *failure* counter with **reset-on-success** and a **per-account** key -
  semantics `@fastify/rate-limit` (counts every request, IP-keyed, no reset) does not model. A small
  limiter mirrors the existing `SessionStore` pattern (Redis impl + deterministic in-memory impl for
  tests) and is the reusable unit 0037's admin login needs. Documented as a spec deviation.
- **`trustProxy` must be enabled.** `createApp` does `Fastify()` today, so behind Caddy `request.ip`
  is the proxy's IP - every client would share one bucket. Enable `Fastify({ trustProxy: true })` so
  `request.ip` reflects `X-Forwarded-For`. The **per-account** login key is the spoof-resistant anchor
  (account lockout holds even if XFF is rotated); the per-IP signup cap is best-effort and documented
  (tightening XFF trust at Caddy is a follow-up, out of this control-plane-only scope).
- **node-redis v4** client (`incr`/`expire`/`ttl`/`del`) - the limiter adapts the narrow surface it
  needs (like the `SessionRedis` adapter in index.ts).

## Limiter shape

`src/ratelimit/limiter.ts`:
```
interface RateVerdict { blocked: boolean; retryAfterSeconds: number; }
interface RateLimiter {
  check(key: string, limit: number): Promise<RateVerdict>;   // read count (GET) + TTL; blocked if count >= limit
  record(key: string, windowSeconds: number): Promise<void>; // INCR + EXPIRE-on-first
  reset(key: string): Promise<void>;                         // DEL (login success)
}
```
- `RedisRateLimiter` (keys namespaced `ratelimit:...`), `InMemoryRateLimiter` (deterministic clock,
  for tests), mirroring `store.ts` / `store.memory.ts`.

## Steps

1. **Config** (`config.ts`): add a `rateLimit` block read from env with documented defaults -
   `loginMaxAttempts` (default 5), `loginWindowSeconds` (900), `signupMaxPerIp` (10),
   `signupWindowSeconds` (3600). Cover set/default in `config.test.ts`.
2. **Limiter** (`ratelimit/limiter.ts`, `limiter.memory.ts`): the interface + both impls. Unit-test
   the in-memory impl (window, block-at-threshold, reset, TTL/expiry via the injected clock) and the
   Redis impl against a fake redis (or the in-memory as the contract test).
3. **trustProxy**: `createApp` -> `Fastify({ trustProxy: true })`. Note why in a comment.
4. **Wire into auth** (`routes/auth.ts` + `AuthDeps`): add `limiter: RateLimiter` and the
   `rateLimit` config to `AuthDeps`.
   - `POST /auth/login`: `loginKey = ratelimit:login:{normalizedEmail}:{ip}`. `check` first -> if
     blocked, 429 + `Retry-After`, uniform message (no enumeration). On failed verify, `record`. On
     success, `reset`.
   - `POST /auth/signup`: `signupKey = ratelimit:signup:{ip}`. `check` -> 429 if blocked; else
     `record` then proceed.
   - Keep responses uniform: a locked-out login and a bad password are indistinguishable.
5. **Wire deps** (`app.ts` + `index.ts`): thread `limiter` + `rateLimit` through `AppDeps` ->
   `registerAuthRoutes`. `index.ts` builds a `RedisRateLimiter` from the redis client; `app.test`/route
   tests use `InMemoryRateLimiter`.
6. **Tests**:
   - unit: limiter (in-memory) - block/reset/expiry; config.
   - integration (auth route tests, in-memory limiter + fake ip): Nth+1 login attempt -> 429 with
     `Retry-After`; a success after the window (advance the clock) is allowed; signup capped per IP;
     429 messages are non-enumerating.
7. **docs**: `overview/architecture.md` note - auth endpoints are rate-limited/lockable, the keying
   (account+ip login, ip signup), the trustProxy/XFF trust boundary, and the configurable thresholds.

## Verification (before commit)

- `pnpm --filter @branchout/control-plane test` (units + integration green).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.
- No browser e2e required (API-layer behavior; spec says so).
