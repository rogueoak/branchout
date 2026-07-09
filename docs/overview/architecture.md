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
  game-sdk         the harness<->game plugin contract + dependency injection + test helpers
  games/trivia     the Trivia game as an independent @branchout/game-sdk plugin package
  games/liar-liar  the Liar Liar bluffing game as an independent plugin package (engine logic)
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
  in Postgres. Auth sessions live here too: an opaque id in an httpOnly cookie keys a
  server-side session with a sliding TTL, so log out / ban revokes instantly (spec `0004`).
- **Schema** - the control-plane owns a minimal forward-only migration runner
  (`schema_migrations` ledger + ordered SQL, applied on boot and via a `migrate` script). Add a
  migration by appending the next id; never edit a shipped one (spec `0004`).

## Design system and theme

UI is built on rogueoak/canopy (`@rogueoak/canopy` components + `@rogueoak/roots` tokens).
Branch out ships its own **Confetti** brand (violet + hot pink + sunny yellow) through canopy's
brandable theme API - custom primitive ramps mapped onto the same semantic role names, so every
canopy component re-themes with no component changes, in light and dark, AA-verified. That API
ships upstream as `@rogueoak/roots/brand` (canopy PR #37 - a `buildBrand()` function + a
`roots-brand` CLI); `packages/theme` consumes it once released. See spec `0002`.

## Open Graph share cards (spec 0020)

Link unfurls are driven by pre-rendered static images, not a runtime renderer. `packages/brand`
rasterizes the SVG source (`sharp`) into the home wordmark card and one "Join my game" card per
game (plus a generic fallback) at build time, copying them into `apps/web/public`; the web build
depends on the brand build, so the cards exist before it runs. The only runtime decision is
*which* card a share link points at: the join page's `generateMetadata` resolves the room's game
and maps it to a card (`lib/share-card.ts`). Because a link crawler has no session and is not a
room member, it cannot use the member-gated `getRoom`; instead the control-plane exposes a public
`GET /rooms/:code/preview` returning only `{ code, status, selectedGame }` (no member/session
data). Because `generateMetadata` runs server-side, it fetches that endpoint through the
server-only `CONTROL_PLANE_URL` (service name / origin), not the browser's
`NEXT_PUBLIC_CONTROL_PLANE_URL` (a relative `/api` or a published `localhost` port that would not
resolve from inside the web container) - the same client/server URL split `lib/session.ts` uses.
Any preview failure falls back to the generic card, so a share link never fails to unfurl.
Absolute `og:image` URLs come from `metadataBase` (seeded by `NEXT_PUBLIC_SITE_URL`).

## Deployment

Docker Compose, both locally and on a server. Kubernetes is a someday, not a now.

**Local dev** uses `infra/docker-compose.yml` (production-shaped base: build each image, run its
`start` command, healthchecks) with `infra/docker-compose.override.yml` auto-merged by a plain
`docker compose up` for hot reload (bind-mounts the repo, runs each app's `dev` script). For playing
on real phones over the LAN, `pnpm dev:lan` (spec `0024`) detects the host's LAN IP (`lanIp()` in
`service-runtime`), passes it as `LAN_HOST` into the override so the browser's `NEXT_PUBLIC_*` URLs,
the control-plane CORS origin, and the session cookie target that IP, and prints the URL to open on
phones - production stays same-origin behind Caddy and is untouched.

**Production** (`branchout.games`, one DigitalOcean droplet - spec `0011`) runs two compose stacks
on a shared external Docker network, `edge`, defined under `deploy/docker/`:

- `compose.proxy.yml` - the **proxy** stack. Caddy, the only container publishing host ports
  80/443. Terminates TLS (auto-ACME), enforces HSTS, and does same-origin path routing:
  `/api/*` -> `control-plane:4000`, `/ws/*` -> `game-engine:4001` (WebSocket upgrade), everything
  else -> `web:3000`. `www` redirects to the apex. ACME data persists in a named volume. One
  domain, one certificate, first-party session cookie, no CORS.
- `compose.site.yml` - the **branchout** app stack. The three private GHCR images
  (`ghcr.io/rogueoak/branchout/<app>:sha-<commit>`) plus Postgres and Redis. It publishes no host
  port; Caddy reaches the app services over `edge`. Only the three app services join `edge`;
  Postgres and Redis sit on an internal-only `db` network with no host port. `web` is on `edge`
  only (it reaches control-plane there for SSR) - it never touches the data tier directly.

Deploys are hands-off: every push to `main` runs `.github/workflows/release.yml`
(verify -> build the three images -> deploy). The deploy job SSHes into the droplet as `deploy`,
force-syncs the repo, pulls the run's private images (GHCR login with the run-scoped
`GITHUB_TOKEN`, `packages: read`), writes `deploy/docker/.env.prod` from GitHub secrets, and rolls
the stack forward health-gated with `up -d --wait`. Server secrets live only in that host env file
and in GitHub Actions secrets - never in the repo. Rollback is a redeploy of an older `sha`;
`cleanup-images.yml` bounds image disk use. See `deploy/README.md` for host setup and secrets.

## Build tooling

Turborepo drives `build`/`lint`/`test`/`typecheck`. Shared config (tsconfig, flat ESLint,
Prettier) lives in `packages/config`; the root files re-export it. The `protocol` package and
the two services build with `tsup` (bundled ESM); services run with `tsx` in dev and
`node dist` in prod. `web` builds with `next build` (Tailwind v4 via `@tailwindcss/postcss`).
`packages/protocol` carries both the shared message types and the `ws`-backed transport adapter
behind a transport-agnostic interface, so the realtime transport can change without touching
game logic.

## Testing (spec 0024)

Three layers, cheapest first. **Unit** (vitest) covers pure logic and components. **Integration**
(Fastify `inject` with in-memory stores) covers each service's routes without infrastructure. Both
run under `turbo run test` (`pnpm test`) - fast, no Docker. **End-to-end** (Playwright, the `e2e/`
workspace) drives a real browser against the full `docker compose` stack (web + control-plane +
game-engine + Postgres + Redis) using the dev overlay, so the browser reaches services on published
`localhost` ports. `globalSetup` builds the workspace, brings the stack up under a dedicated
`branchout-e2e` project on shifted ports (`--wait` gates on healthchecks), and tears it down after.
E2e is intentionally **not** part of `pnpm test` (it exposes an `e2e` script, not `test`) - it runs
as its own CI job so the normal test loop never needs Docker.

## Game engine and protocol (spec 0007)

`packages/protocol` is the source of truth for two channels, each a versioned envelope (`v`)
so a shape can change without breaking older peers:

- **Player <-> engine (WebSocket).** Client frames `join`, `answer`, `vote`; server frames
  `prompt`, `reveal`, `leaderboard`, `state`. Each game frame is keyed by room + game (client
  frames also by player). `parseMessage` validates ingress; the engine constructs egress. The
  `state` frame carries the round's `disputes` (playerIds) so a client can render the voting phase.

### Player identity: public `playerId` vs private `sessionId` (spec 0012)

A room member has two ids. `sessionId` is the value of the httpOnly auth cookie: it authenticates
control-plane calls, is the kick/rejoin key, and is never exposed to JS (only the host sees other
members' session ids, for kicking). `playerId` is a separate random token minted on create/join and
stored beside `sessionId` in Redis membership; it is the *public* identity - the engine
start-handoff roster (`toHandoffPlayers`) and the engine `join` key on it, and it is echoed to the
browser on join and in `/members`, because the engine already broadcasts it in every `state` frame's
`players[].player`. This split lets a non-host browser (which cannot read its httpOnly cookie) learn
an engine identity without ever exposing the session token. Rule: a browser-facing service echoes
the *public* identity a UI needs, never the secret that authenticates the caller.
- **Engine <-> control-plane (REST).** `start` handoff (control-plane -> engine), `round` result
  and `game-complete` standings (engine -> control-plane). Each report carries a stable id
  (`roundId`, `gameId`) so a retry never double-bills - the transport is internal REST, chosen
  over a queue for simplicity at this scale (revisit if reporting volume outgrows it).

`apps/game-engine` (Fastify + `ws`) owns:

- **A game SDK and plugin runtime** (`@branchout/game-sdk`, spec `0018`) - a game ships as a
  `GamePlugin`: a manifest (id, name, version, a config schema, capabilities) plus a
  `create(services)` factory the harness calls with injected dependencies (an rng, a logger, a
  per-package asset loader), returning the pure `GameModule` that implements the generic round
  lifecycle (`configure -> startRound -> collectAnswers -> reveal -> disputeWindow -> disputeVote
  -> leaderboard -> advance`, plus `endGame`). The engine's composition root builds the services,
  `registerPlugins` instantiates each plugin into the registry and collects its config schema, and
  `/sessions` validates the handoff config against that schema before configuring; the engine still
  sequences phases, timers, streaming, persistence, and reporting while the module owns what each
  phase means. Adding a game is adding its plugin to the boot list; a stub game (an SDK test
  fixture) drives the lifecycle in tests (Trivia is spec `0008`). After `reveal` a game takes one of
  two opt-in post-reveal shapes (spec `0020`): the `disputing -> voting` dispute path (Trivia), or a
  generic **guess** phase - `reveal` returns a `decision`, the engine opens a `guessing` window,
  collects choices via the `vote` frame, then calls `resolveDecision` to score (the shape Liar Liar
  uses). A module may also **reject a single submission** (`collectAnswer` returns `rejected`): the
  engine replies to that one device with a targeted `answer_rejected` frame and writes no state -
  never a broadcast (used for "someone already submitted that" in a bluffing game).
- **Session state in Redis** keyed by room + game (phase, players, scores, per-game scratch) for
  the life of a game, recovered on reconnect. It also persists the current phase's streamed frames
  (prompt/reveal/standings) so `join` can replay them as ordered catch-up - pub/sub only reaches
  devices subscribed at publish time, so a late joiner would otherwise never see the question
  (feedback `0014`). The roster carries `isHost` (from the handoff) so the engine auto-pauses while
  the host is disconnected. Per-session operations are serialized in-process so concurrent frames
  cannot lose an update; cross-instance locking is a future concern.
- **Streaming over Redis pub/sub** - the engine publishes server frames to a per-session channel;
  each connected device subscribes and forwards them to its socket. Both the store and pub/sub
  sit behind interfaces with in-memory implementations for tests.
- **Host controls** (`pause`, `advance`, `restart`, `exit`) and the control-plane channel as
  Fastify routes (`POST /sessions`, `POST /sessions/:room/:game/control`) plus an outbound
  reporter client.

## Conventions

Trellis (`docs/rules/`) and Spectra (`docs/spectra/`) govern how changes ship: specs before
features, tests/lint/build green before merge, persona review on PRs.
