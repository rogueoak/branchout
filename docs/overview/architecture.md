# Architecture

## Shape

A monorepo for the whole platform and its games. Everything is TypeScript. Tooling matches
canopy: pnpm workspaces + Turborepo.

```
apps/
  web            Next.js - marketing site + web game client (uses canopy + Branch out theme)
  control-plane  Fastify service - accounts, profiles, purchases, rooms, chat, accounting
  game-engine    Fastify + WebSocket service - runs the games, holds live game state
packages/
  theme          Branch out brand theme built on @rogueoak/roots (the brandable API)
  brand          logo, icon, and favicon assets (from assets/)
  protocol         shared TypeScript types + contracts (control-plane <-> engine <-> web)
  service-runtime  shared Fastify-service helpers (env parsing, Redis client)
  config           shared tsconfig, eslint, prettier
infra/
  docker-compose.yml   Postgres + Redis + the three apps, runnable end to end locally
```

Future `ios` and `android` apps are clients of the same control-plane and game-engine APIs;
nothing platform-specific leaks into those services.

## Services and responsibilities

- **control-plane** - the system of record. Accounts, profiles (gamer tag, nickname, avatar,
  privacy, online + player status), friends, stars, subscriptions and daily credits, purchases.
  Owns rooms (create, join, host, observers, interactive/remote mode, the "at least one viewer"
  rule) and orchestrates game start/stop. It does not run game logic; it keeps the books:
  billing and scoring from the results the engine reports.
- **game-engine** - runs the selected game and holds its state for the life of a game. Players'
  devices connect to it to push answers and stream back updates. One engine hosts all games for
  now, kept modular via a game registry so a game can later split into its own engine. At the
  end of each round it reports state and results to the control-plane; on game complete it
  reports final standings for stars.
- **web** - the marketing site and the browser game client: lobby, the interactive layout
  (viewer left, remote right; stacked on small screens), in-game screens, profiles, and friend
  search/invite.

## Game control flow

1. Control-plane creates a room (for a chosen game, or empty to pick later). Host has an
   account; other players may be anonymous or signed in. Observers may join.
2. Each player picks **interactive** (viewer + remote on one screen) or **remote** mode. A game
   needs at least one viewer - an observer or an interactive player.
3. Host starts the game once a game is selected and the subscription allowance covers it.
   Players are redirected into the game; the engine takes over.
4. Games run in rounds. Host may pause, restart, or exit. Each finished round reports to the
   control-plane for billing and scoring.
5. On completion, in-game points convert to stars (win 3, second 2, third 1; games may define
   custom scoring). Control regains to the control-plane, which re-checks the host's allowance
   before the next game.

## Data

- **Postgres** - durable system of record: accounts, profiles, friends, stars, subscriptions,
  credit ledger, purchases, room and game history.
- **Redis** - live, ephemeral state: room membership and presence, online/player status, game
  session state and pub/sub for streaming updates. Anything that must survive a restart lands
  in Postgres.

## Design system and theme

UI is built on rogueoak/canopy (`@rogueoak/canopy` components + `@rogueoak/roots` tokens).
Branch out ships its own **Confetti** brand (violet + hot pink + sunny yellow) through canopy's
brandable theme API - custom primitive ramps mapped onto the same semantic role names, so every
canopy component re-themes with no component changes, in light and dark, AA-verified. That API
ships upstream as `@rogueoak/roots/brand` (canopy PR #37 - a `buildBrand()` function + a
`roots-brand` CLI); `packages/theme` consumes it once released. See spec `0002`.

## Deployment

Docker Compose, both locally and on a server. `docker compose up` brings up Postgres, Redis,
and the three apps as one runnable system - the same file in dev and prod. Kubernetes is a
someday, not a now.

`infra/docker-compose.yml` is the production-shaped base (build each image, run its `start`
command, healthchecks). `infra/docker-compose.override.yml` is auto-merged by a plain
`docker compose up` for local dev: it bind-mounts the repo and runs each app's `dev` script for
hot reload. Deploy with `-f docker-compose.yml` to skip the override.

## Build tooling

Turborepo drives `build`/`lint`/`test`/`typecheck`. Shared config (tsconfig, flat ESLint,
Prettier) lives in `packages/config`; the root files re-export it. The `protocol` package and
the two services build with `tsup` (bundled ESM); services run with `tsx` in dev and
`node dist` in prod. `web` builds with `next build` (Tailwind v4 via `@tailwindcss/postcss`).
`packages/protocol` carries both the shared message types and the `ws`-backed transport adapter
behind a transport-agnostic interface, so the realtime transport can change without touching
game logic.

## Game engine and protocol (spec 0007)

`packages/protocol` is the source of truth for two channels, each a versioned envelope (`v`)
so a shape can change without breaking older peers:

- **Player <-> engine (WebSocket).** Client frames `join`, `answer`, `vote`; server frames
  `prompt`, `reveal`, `leaderboard`, `state`. Each game frame is keyed by room + game (client
  frames also by player). `parseMessage` validates ingress; the engine constructs egress.
- **Engine <-> control-plane (REST).** `start` handoff (control-plane -> engine), `round` result
  and `game-complete` standings (engine -> control-plane). Each report carries a stable id
  (`roundId`, `gameId`) so a retry never double-bills - the transport is internal REST, chosen
  over a queue for simplicity at this scale (revisit if reporting volume outgrows it).

`apps/game-engine` (Fastify + `ws`) owns:

- **A modular game registry** - a game is a `GameModule` implementing the generic round
  lifecycle (`configure -> startRound -> collectAnswers -> reveal -> disputeWindow -> disputeVote
  -> leaderboard -> advance`, plus `endGame`). The engine sequences phases, timers, streaming,
  persistence, and reporting; the module owns what each phase means. Adding a game is registering
  a module; a stub game drives the lifecycle in tests (Trivia is spec `0008`).
- **Session state in Redis** keyed by room + game (phase, players, scores, per-game scratch) for
  the life of a game, recovered on reconnect. Per-session operations are serialized in-process so
  concurrent frames cannot lose an update; cross-instance locking is a future concern.
- **Streaming over Redis pub/sub** - the engine publishes server frames to a per-session channel;
  each connected device subscribes and forwards them to its socket. Both the store and pub/sub
  sit behind interfaces with in-memory implementations for tests.
- **Host controls** (`pause`, `advance`, `restart`, `exit`) and the control-plane channel as
  Fastify routes (`POST /sessions`, `POST /sessions/:room/:game/control`) plus an outbound
  reporter client.

## Conventions

Trellis (`docs/rules/`) and Spectra (`docs/spectra/`) govern how changes ship: specs before
features, tests/lint/build green before merge, persona review on PRs.
