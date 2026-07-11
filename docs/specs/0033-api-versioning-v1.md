# 0033 - API versioning under /v1

> **Foundational - builds first.** Though numbered after `0027`-`0032`, this spec lands before them:
> it sets the URL convention every current and future API is built on, so the marketing/profiles
> batch is written on `/v1` from the start rather than reworked. (Spec numbers are ids, not build
> order - see `docs/specs/README.md`.)

## Problem

Our HTTP and WebSocket APIs have no version in their paths. The control-plane serves `/auth/*`,
`/rooms/*`, and the internal `/engine/*` intake at the root; the game-engine serves `/sessions/*` and
a WebSocket at the root; web clients call those bare paths. With no version prefix, the day we need a
breaking API change we have no way to run old and new shapes side by side, and no clear "this is the
current version" contract. The developer wants **all APIs under a version prefix, with `/v1` as the
current version**, established now - before the next batch of features (`0027`-`0032`) adds more
endpoints - so everything is versioned from the outset.

## Outcome

- Every functional API path is served under **`/v1`**:
  - control-plane: `/v1/auth/*`, `/v1/rooms/*`, `/v1/profiles/*`, and the internal
    `/v1/engine/*` report intake.
  - game-engine: `/v1/sessions/*` and the player WebSocket under a `/v1` path.
- **`/health`** on both services stays at the root, unversioned - it is an operational liveness
  probe (compose healthchecks, the Caddy edge, uptime checks), not a product API, and versioning it
  would churn infra for no benefit.
- The version prefix is a **single shared constant** (`@branchout/protocol`), imported by both
  services and the web client, so it is defined once and never a scattered magic string.
- All callers move in lockstep: the web client, the engine's report client, the Caddy internal-route
  block, and the tests/e2e - so nothing breaks. Same-origin prod routing still works: the browser
  calls `/api/v1/...` (Caddy strips `/api`, the control-plane serves `/v1/...`).
- Covered by tests: the new paths respond, `/health` stays unversioned, and a request to an old
  un-versioned functional path 404s (proving the move is real, not additive-by-accident).

## Scope

In:

- **Shared constant**: export `API_VERSION = 'v1'` and a `V1_PREFIX = '/v1'` from
  `@branchout/protocol` (a leaf module, no heavy deps), the single source of truth for the prefix.
- **control-plane** (`app.ts`): mount the auth, rooms, profiles, and engine-intake route groups under
  the `/v1` prefix (Fastify `register(..., { prefix })` or an equivalent wrapping), leaving `/health`
  at the root. The `x-internal-token` gate on `/v1/engine/*` is unchanged.
- **game-engine** (`app.ts`): mount `/sessions/*` under `/v1`; leave `/health` at the root. Version
  the **WebSocket** path so the player channel connects under `/v1` (the engine ws currently accepts
  any path - make the client use a `/v1` path and have the engine treat that as canonical; keep it
  tolerant per the versioned-envelope learning rather than hard-rejecting a bare path unless we
  decide to enforce).
- **Engine reporter** (`reporter.ts` / its configured base URL): target `/v1/engine/*` so
  round/complete reports still land.
- **web clients**: prefix every control-plane call in `lib/room-api.ts`, `lib/session.ts`,
  `lib/room-preview.ts`, and the share-card/join preview fetch with `/v1`; build the engine
  WebSocket URL (`lib/engine.ts` + `lib/game-client.ts`) under `/v1`. Use the shared constant, not a
  hand-typed string, wherever practical.
- **Caddy** (`deploy/docker/Caddyfile`): update the internal block `handle /api/engine/*` ->
  `handle /api/v1/engine/*` (keep it before the general `/api/*` proxy). The `handle_path /api/*` and
  `@ws path /ws /ws/*` rules already match the versioned paths (prefix-based), so they need no change;
  update the explanatory comments to show the `/v1` paths.
- **Tests + e2e**: update every hard-coded path in unit/integration tests and the `e2e/` harness to
  `/v1`; add assertions that `/health` is unversioned and that a bare functional path (e.g.
  `/auth/me`) no longer resolves.
- A short note in `overview/architecture.md` recording the `/v1` convention and the health exception.

Out:

- **Introducing a `/v2` or any actual breaking change** - this only establishes `/v1` as the current
  version; there is one version and it is the present behavior, unchanged in shape.
- **Content negotiation / header-based versioning** - we version in the path (simple, cache-friendly,
  visible in logs), not via `Accept` headers.
- **Deprecation tooling, sunset headers, or a version-negotiation handshake** - future concern if we
  ever run two versions at once.
- **Changing any endpoint's behavior, request/response shape, or auth** - paths move, semantics do
  not.
- Versioning `/health` or other pure-infra endpoints.

## Approach

- **One prefix, one constant, mounted at composition.** Define the prefix once in `@branchout/protocol`
  and apply it at each service's route-composition root (`app.ts`) via a Fastify prefix, so
  individual route modules stay path-relative and unaware of the version. This keeps the change
  mechanical and localized and makes a future `/v2` a matter of mounting a second prefixed tree.
- **Move, don't duplicate.** `/v1` replaces the bare paths; we do not keep the un-versioned routes as
  aliases. A test asserting the old path 404s proves the migration is complete and prevents a
  half-moved state where clients silently keep hitting the root.
- **Health is infra, not product.** Liveness/readiness probes are consumed by orchestration
  (compose `--wait`, Caddy, uptime monitors), keyed to a stable unversioned URL by convention; they
  carry no API contract to version. Keeping `/health` at the root avoids editing healthchecks and
  the Caddy config for zero contract benefit. (Flagged decision - trivial to also move it under
  `/v1` if the developer prefers strict uniformity.)
- **Same-origin prod is already compatible.** Caddy's `handle_path /api/*` strips `/api` and proxies
  the remainder, so `/api/v1/auth/login` arrives at the control-plane as `/v1/auth/login` with no
  Caddy rule change; only the internal `/engine` guard's path gains `/v1`. Local/dev and `dev:lan`
  keep working because the web client composes `NEXT_PUBLIC_CONTROL_PLANE_URL + /v1 + path`.
- **Lockstep, test-guarded.** Because a missed caller is a runtime 404, the safety net is the test
  and e2e suites: update paths everywhere and let the real-stack e2e (spec `0026`) prove the browser
  reaches `/v1` across the wired services (the "drive the real stack for wiring bugs" learning).
- **ASCII-only, minimal churn** to comments/docs so the convention is self-explanatory.

## Acceptance

- [ ] `@branchout/protocol` exports the version constant/prefix; control-plane, game-engine, and web
      all consume it rather than hard-coding `'/v1'`.
- [ ] control-plane serves `/v1/auth/*`, `/v1/rooms/*`, `/v1/profiles/*`, `/v1/engine/*`; the bare
      equivalents 404; `/health` still responds at the root.
- [ ] game-engine serves `/v1/sessions/*` and the player WebSocket under `/v1`; `/health` still
      responds at the root.
- [ ] The engine reporter posts round/complete reports to `/v1/engine/*` and they are billed/scored
      as before.
- [ ] The web client (rooms, auth/me, room preview, share card, engine WS) calls `/v1` paths; a full
      flow works locally and behind the Caddy edge (`/api/v1/...`).
- [ ] The Caddy internal guard blocks `/api/v1/engine/*` from the internet; `/api/v1/*` reaches the
      control-plane and `/ws/*` still upgrades to the engine.
- [ ] Unit/integration tests and the `e2e/` harness use `/v1`, assert `/health` is unversioned, and
      assert an old bare functional path no longer resolves.
- [ ] `overview/architecture.md` records the `/v1` convention and the `/health` exception.
</content>
