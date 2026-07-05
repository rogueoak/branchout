# 0001 - Monorepo scaffold + local docker-compose

## Problem

Branch out is greenfield. Before any feature can ship, you need a workspace that holds the three
apps and the shared packages, builds and lints them together, and runs the whole system locally
with one command. This spec is the shared setup the rest of the roadmap references, so it is the
first spec of the foundations group. It ships nothing user-facing on its own - it makes every
later spec small.

## Outcome

- `pnpm install` at the root sets up the whole workspace.
- `pnpm build`, `pnpm lint`, `pnpm test` run across all packages via Turborepo and pass.
- `docker compose up` in `infra/` brings up Postgres, Redis, and the three apps wired together;
  each app answers a health check and can reach Postgres and Redis.
- Each app runs standalone in dev (`pnpm dev` filtered to one app) with hot reload.
- A new engineer goes from clone to a running system by reading one Quick start in the README.

## Scope

In:
- Root workspace: `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `tsconfig.base.json`.
- `packages/config` - shared `tsconfig`, eslint (flat config, matching canopy), prettier.
- `packages/protocol` - empty-but-wired shared-types package the services will grow into.
- `apps/web` - Next.js app (TypeScript), boots to a placeholder home page.
- `apps/control-plane` - Express + TypeScript service, `/health` endpoint, Postgres + Redis
  clients read from env.
- `apps/game-engine` - Express + TypeScript service with a WebSocket endpoint, `/health`,
  Redis client.
- `infra/docker-compose.yml` - Postgres, Redis, and the three apps; `.env.example`.
- CI - one workflow running install, build, lint, test.
- Repo hygiene per Trellis: `LICENSE`, `README.md` (with Quick start), `CONTRIBUTING.md`.

Out:
- Any real feature logic (accounts, rooms, games), database schema/migrations beyond a
  connectivity check, and auth. Those are later specs.

## Approach

- Match canopy's toolchain so the two repos feel the same: pnpm workspaces, Turborepo, Tailwind
  v4 in `web`, TypeScript project references, flat eslint config, prettier.
- **Both services use Express** for consistency and to match the stated preference for plain,
  classic Node services. Decision to confirm in review: `control-plane` could instead use
  Fastify for its schema/validation story; this spec picks Express for one framework across both
  services. Flag it if you disagree.
- Realtime on `game-engine`: Express does not speak WebSocket natively. Start with the `ws`
  library behind a thin adapter in `packages/protocol` so the transport can change later. Note
  in review: Socket.IO would buy rooms, reconnection, and presence out of the box - call it if
  you want that instead of hand-rolling on `ws`.
- Postgres and Redis clients read connection strings from env; no schema yet, just a startup
  connectivity check so `docker compose up` proves the wiring.
- `docker-compose.yml` is the single source of local truth and the same file used to deploy on a
  server. Apps get their own Dockerfiles; dev uses bind mounts for hot reload.
- Keep each app's entrypoint tiny; business logic arrives in later specs.

## Acceptance

- [ ] Fresh clone: `pnpm install && pnpm build && pnpm lint && pnpm test` all pass.
- [ ] `docker compose -f infra/docker-compose.yml up` starts Postgres, Redis, web,
      control-plane, game-engine; each app's `/health` returns ok.
- [ ] control-plane health check confirms it can reach both Postgres and Redis; game-engine
      confirms Redis and accepts a WebSocket connection that echoes a message.
- [ ] `web` serves a placeholder page styled with a canopy component to prove the design-system
      wiring (final theme lands in `0002`).
- [ ] Root `README.md` Quick start takes a new engineer from clone to running in the listed
      steps; `LICENSE` and `CONTRIBUTING.md` present.
- [ ] CI runs install/build/lint/test on push and passes.
