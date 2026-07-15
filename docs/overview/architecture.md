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
  reports final standings for stars. Session state lives in Redis and modules are pure callbacks -
  with one exception: a **live game** (spec 0043, e.g. Teeter Tower). A live module implements
  `GameModule.tick` and streams a `sim` frame; the engine runs a per-session continuous sim loop
  (~25 fps) that steps the module and broadcasts the snapshot, and the module holds an in-process
  (non-Redis) world - a Matter.js physics world - outside the Redis-backed session state. A compact
  scratch snapshot in Redis rebuilds that world after a reconnect/restart, and the engine calls the
  module's `disposeLive` on end/exit/restart so the in-process world is released (no leak, and a
  restart rebuilds from empty scratch rather than reusing the stale world). Every session's module -
  including that live physics world and its ~25 fps tick - runs in its **own Node worker_thread**
  (spec 0045), so game CPU stays off the main event loop and a hung/crashed game is contained and
  auto-recovered without touching other rooms.
- **web** - the marketing site and the browser game client: lobby, the interactive layout
  (viewer left, remote right; stacked on small screens), in-game screens, profiles, and friend
  search/invite.

## API versioning (spec 0033)

Every functional API - control-plane REST (`/v1/auth`, `/v1/rooms`, and the internal `/v1/engine`
report intake), game-engine REST (`/v1/sessions`), and the player WebSocket (connected at `/v1`) -
is served under a `/v1` path prefix, so a future breaking change can run a second version beside it.
The prefix is one shared constant (`V1_PREFIX` in `@branchout/protocol`) imported by both services
and the web client, never a scattered literal; each service mounts its routes in one prefixed
context so the route modules stay path-relative. `/health` is the deliberate exception: it is an
operational liveness probe (compose healthchecks, the Caddy edge, uptime monitors), not a product
API, so it stays at the root, un-versioned. Same-origin prod routing is unaffected - Caddy strips
`/api` and proxies the rest, so the browser's `/api/v1/auth/login` reaches the control-plane as
`/v1/auth/login`; only the internal engine-intake guard's path gains `/v1`. The engine's reporter
targets the control-plane origin and appends the full `/v1/engine/...` intake path itself, so the
version lives in code (not in the `CONTROL_PLANE_URL` env value, which is the plain origin).

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

## External game data (spec 0041)

The real game banks (Trivia questions, Liar Liar clues) live in a separate **private** repo
(`rogueoak/branchout-data`), not in this public monorepo. The public repo ships only a tiny valid
**sample** under each game's `data/` (8 Trivia items per category, 5 Liar Liar per category, all 8
categories) so the code, unit tests, and local runs stay honest without carrying the full content.
The game SDK's fs asset loader (`packages/game-sdk`) has one branch: if `GAME_DATA_DIR` is set and
non-empty it reads every game's `data/` from that mount, else it walks up to the game package's own
bundled sample. The relative read paths (`data/trivia/...`, `data/liar-liar/...`) are unchanged, so a
single mount root serves both games. Boot-time validation is **structural per-item only** (id format
+ uniqueness, required fields, bounded difficulty, no duplicate prompt in a category); there is no
total/per-category count or difficulty-spread gate, because the bank grows over time and its spread
is deliberately uneven - a fixed count/spread check would only fight the content.

The content is versioned by a git **tag** in the private repo, pinned in `deploy/data.version` (a
bare semver). On every deploy the box fetches and checks out that tag from its own clone of
`branchout-data`, authenticating with a **read-only deploy key** scoped to that repo (a `github-data`
SSH alias), then writes `GAME_DATA_HOST` into `.env.prod`. The sync is best-effort: an unreachable
GitHub or a missing tag leaves the last-good checkout in place rather than blocking the app deploy.
`compose.site.yml` bind-mounts `${GAME_DATA_HOST}/data` read-only into `game-engine` (the real
reader) and `admin` (for future moderation) at `/srv/game-data/data`, with
`GAME_DATA_DIR=/srv/game-data`. The read-only mount is identical on both docker-rollout instances, so
it is compatible with the zero-downtime swap.

## Auth rate limiting (spec 0036)

The auth endpoints are rate-limited/lockable against brute force and mass account creation, backed by
the Redis we already run (a small fixed-window counter, `RateLimiter`, with an in-memory variant for
tests - the same store-plus-fake shape as sessions). **Sign-in** locks on the **account** alone
(`login:<email>`) and resets on a successful login. The account is the anchor because it is the one
dimension the caller cannot forge - defence-in-depth that holds even if the IP trust chain ever
regresses. **Sign-up** caps per client IP, and that IP is now **trustworthy**: the Caddy edge
**replaces** `X-Forwarded-For` with the true connection peer (`{remote_host}`) before proxying to
control-plane (spec `0038`), so a client can no longer forge it to rotate past the cap. `request.ip`
is reliable under one assumption - the droplet terminates TLS directly (no LB/proxy in front); revisit
the trusted hop if that changes. Over-limit returns `429` + `Retry-After` with a uniform message, so
the limiter is never an account-enumeration oracle. `Fastify({ trustProxy: true })` reads that
edge-sanitized header (else every client would share the proxy's IP). The fixed window has a known
~`2x limit` boundary burst.
Thresholds are env-tunable (`LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_SECONDS`, `SIGNUP_MAX_PER_IP`,
`SIGNUP_WINDOW_SECONDS`); the limiter is reused by the admin login (spec `0037`).

## Host in-game feedback (spec 0048)

The host can send feedback from inside a live game. The web `FeedbackDialog` (canopy's
`ResponsiveDialog` - a modal on desktop, a bottom sheet on a phone) POSTs `{ message, context }` to
the control-plane `POST /v1/feedback`; the context (room code, game id, current game phase, that the
sender is the host, a timestamp) is auto-captured from state `GameStage` already holds, never typed,
and carries no session token or PII beyond what the recipient needs. The send is **server-side** so
`RESEND_API_KEY` stays off the browser: `registerFeedbackRoutes` composes a plain-text body and sends
via a `FeedbackMailer` - a `ResendMailer` that is a **direct `fetch` to Resend's REST API** (no new
dependency, with a ~10s abort timeout), injectable so tests fake it. The from/to addresses live in one
const module (`feedback/addresses.ts`), not scattered literals. The endpoint is **cookie-authenticated
and host-verified like the room routes** because it spends money (Resend) and writes to a human inbox:
an anonymous caller gets `401`, and when the context names a room the caller is verified to be that
room's host via `rooms.resume` (`403` otherwise), so `isHost` is server-checked, not trusted from the
body. It validates the message (non-empty, capped at 5000; untrusted context strings sliced to 200),
rate-limits per IP with the shared spec-0036 `RateLimiter` (tunable
`FEEDBACK_MAX_PER_IP`/`FEEDBACK_WINDOW_SECONDS`, recorded on every processed path so none is
unlimited), and - when `RESEND_API_KEY` is unset - returns a clear
`503 { ok:false, error:'Feedback email is not configured yet.' }` and logs a warning rather than
crashing, so the code ships before the secret is provisioned. An operator sets `RESEND_API_KEY` (wired
through env.example, the control-plane config, compose, and `release.yml`) and must have `rogueoak.com`
verified as a Resend sending domain for `branchout@rogueoak.com`.

## Newsletter subscribe (spec 0047)

A visitor can join the Constant Contact (CTCT) "Branch Out" mailing list from a "More games coming
soon" banner on `/games`. The capture endpoint lives in the **control-plane** (`POST /v1/subscribe`,
`/api/v1/subscribe` in prod), NOT the Next `web` app - branchout holds server secrets in the
control-plane, so the CTCT OAuth credentials never reach the browser (unlike the sibling rogueoak
single-app site, whose route owns them). The pure, unit-tested core (`apps/control-plane/src/subscribe/`)
ports rogueoak's logic: the refresh-token -> access-token exchange, an in-memory access-token cache with
a 60s skew (mint once, reuse across requests, share one in-flight mint on a cold-cache burst), a
single-retry self-heal that clears the cache and re-mints on a stale-token 401, and the additive
`sign_up_form` contact create (`create_source: "Contact"`, `list_memberships: [<CTCT_LIST_ID>]`). `fetch`
and the clock are injected the way the rest of the service injects dependencies, so the network and
expiry are mocked in tests. The route reuses the account email validator, drops a filled honeypot
(`company`) silently, and rate-limits per IP with the **shared spec 0036 `RateLimiter`** the auth routes
use (`subscribe:<ip>`, tunable via `SUBSCRIBE_MAX_PER_IP`/`SUBSCRIBE_WINDOW_SECONDS`, defaults 5 / 600s).
Errors carry only an HTTP status, never the CTCT response body (which can echo the submitted email), so
no PII lands in logs or the client response.

The endpoint **fails inert, not closed-with-a-500**: `CTCT_CLIENT_ID`/`CTCT_REFRESH_TOKEN`/`CTCT_LIST_ID`
are each optional in config, and any unset one returns `503 { ok:false, error:'Subscribe is not
configured yet.' }` plus a warning log - so the code and env plumbing ship before the secrets exist and
turn on when an operator provisions them (mint the refresh token via `ctct login`; find the list id via
`ctct list list --name "Branch Out"`). **Go-live abuse gate:** because the endpoint lists an arbitrary
third-party email and the honeypot + per-IP cap only deter naive bots, **confirmed (double) opt-in must
be enabled on the "Branch Out" list before the secrets are provisioned** - so a distributed signup-bomb
can at worst trigger one confirmation email to a victim, never a real (unconfirmed) subscription that
would burn sender reputation. CAPTCHA/proof-of-work and a global rate cap are documented future
hardening (spec 0047 "Abuse / go-live"). The secrets flow to prod through `.env.prod` (written by
`release.yml` from GitHub secrets) and `env_file` in `compose.site.yml` - deliberately not listed in the
compose `environment:` block, since an `environment:` key wins over `env_file` even when empty. The web
`SubscribeForm` is a house-built canopy `Input`/`Button` form (branchout's canopy version has no
`SubscribeForm` branch export) that posts to the same relative `/api` base the rest of the browser code
uses (`NEXT_PUBLIC_CONTROL_PLANE_URL` + `V1_PREFIX`).

## Design system and theme

UI is built on rogueoak/canopy (`@rogueoak/canopy` components + `@rogueoak/roots` tokens).
Branch out ships its own **Confetti** brand (violet + hot pink + sunny yellow) through canopy's
brandable theme API - custom primitive ramps mapped onto the same semantic role names, so every
canopy component re-themes with no component changes, in light and dark, AA-verified. That API
ships upstream as `@rogueoak/roots/brand` (canopy PR #37 - a `buildBrand()` function + a
`roots-brand` CLI); `packages/theme` consumes it once released. See spec `0002`.

## Open Graph share cards (spec 0025)

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

## Product analytics (spec 0032)

`apps/web` uses **PostHog**, wired **first-party**: `posthog-js` points at a same-origin `/ingest`
path, and `next.config.mjs` `rewrites()` forward `/ingest/*` to the PostHog US cloud (ingestion +
static assets). So the browser only ever calls our own domain - no third-party tracker hostname, and
ad/tracking blockers that target PostHog's domain do not drop our product data. In prod this sits
behind the same Caddy origin (everything except `/api` and `/ws` routes to `web`, so `/ingest` reaches
Next and is rewritten). One module, `lib/analytics.ts`, owns the client lifecycle and every event
name: `initAnalytics` runs **only in production with a key set** (a silent no-op in dev/test/CI, so
developers never emit), captures manual `$pageview`s on route change (`AnalyticsProvider`), and fires
the funnel via typed helpers (`room_created`, `game_picked`, `invite_copied`/`invite_shared`,
`room_joined`, `game_started`, `game_completed`). A signed-in player is identified by their **public
gamer tag** (never email/session), reset on logout. Session replay and autocapture are **off**, so no
gameplay content or PII is sent - only the explicit events with non-sensitive properties (game id,
round count). Because `NEXT_PUBLIC_*` are inlined at **build** time, `NEXT_PUBLIC_POSTHOG_KEY` is baked
into the web image build (a build arg in `apps/web/Dockerfile`, sourced from the `NEXT_PUBLIC_POSTHOG_KEY`
repo variable in `release.yml`) - the same build-time baking `NEXT_PUBLIC_SITE_URL` needs; a missing
key yields an analytics-off bundle. The privacy policy (spec `0031`) describes exactly this.

## Subdomain surfaces and the insider role (spec 0035)

The insider surface lives at `insider.branchout.games` but is served by the **same `web` process** -
no extra container on the RAM-bound droplet. `apps/web/middleware.ts` is host-aware: a request whose
`Host` starts with `insider.` is invisibly **rewritten** into the `/insider` route tree (Caddy
preserves the upstream `Host`, so `web` sees the subdomain); everything else is the main site. The
detection is a bare-label check (`host.startsWith('insider.')` in `lib/subdomain.ts`), so it works in
prod and in local/e2e where `*.localhost` resolves to 127.0.0.1. The routing logic is pure and
unit-tested; the middleware is a thin adapter.

**Routing is not authorization.** Middleware only routes (plus a cheap signed-out shortcut to the
**apex** login - crossing off the gated host so it never loops the login page back through the tree).
The `app/insider/layout.tsx` is the authoritative gate, run server-side on every insider page: not
signed in -> apex login; signed in but not an insider -> `forbidden()` (a real 403 via Next 15.1
`authInterrupts` + `app/forbidden.tsx`). The apex cannot reach the tree by path - middleware 404s any
`/insider*` request that is not on the insider host.

**The room/join flow is mirrored into the insider tree** (feedback `0029`) so an insider-only game is
played on the insider surface, not bounced to the apex. `app/insider/rooms`, `.../rooms/[code]`, and
`app/insider/join` are thin re-exports of the surface-aware apex pages; the insider host rewrites
`/rooms...` and `/join` into them, so hosting and playing stay on `insider.` end to end (and remain
behind the layout gate). Which games a picker offers is decided by the **surface**, not the viewer's
entitlement: `lib/surface.ts` `getSurface()` reads the request `Host` and returns `{ insider,
linkOrigin }`; the room pages pass it to the picker and the `?game=` deep-link guard, so an
insider-only game appears (and its deep link is honored) only on the insider surface - never on the
apex, even for an entitled insider. The shared chrome crosses its marketing/legal links back to the
apex via `linkOrigin` while the flow's own relative links stay on the insider host.

**Surface-owned nav links stay on the host** (feedback `0030`). `linkOrigin` alone is too blunt: it
crosses *every* nav link, which drags the surface's own content links to the apex too. `TopNav` takes
an explicit `insider` flag so it can split them - the apex-only links (Log in, Sign up, Manage
account) cross via `linkOrigin`, while the **surface-owned** links stay relative on the current host:
the wordmark/home is always `/` (the insider host rewrites `/` into the insider landing), and Games is
`/` on the insider surface (the insider games live on the landing - there is no `/insider/games` page)
and `/games` on the apex. `AccountMenu` and `Footer` carry only apex-only links, so they keep crossing
unchanged. The insider landing itself leads with one centered welcome and gives each test-game card a
"Play now" CTA inside its (single) card link.

The insider room flow's credentialed browser calls reach the control-plane **same-origin** via `/api`
(prod bakes `NEXT_PUBLIC_CONTROL_PLANE_URL=/api`; Caddy's `insider.` block re-serves `/api` per host,
so there is no cross-origin call and the `.branchout.games` session cookie flows). Dev/e2e has no
Caddy, so the web app's `next.config` proxies `/api` -> the server-side `CONTROL_PLANE_URL`. The
proxy is emitted only when `NODE_ENV !== 'production'` (dev/e2e run `next dev`): prod's `web` also
sets `CONTROL_PLANE_URL` for SSR, so guarding on that alone would emit the proxy in prod and expose
the internal-only `/api/v1/engine/*` money endpoint on the web tier - Caddy owns `/api` in prod and
Next must never proxy it. The e2e overlay points the browser at `/api` so the insider subdomain
authenticates over http (a cross-origin call to the control-plane port cannot - `*.localhost` is
cross-site for SameSite). SSR keeps using the server-only `CONTROL_PLANE_URL`.

The gate reads an account-level **`insider`** flag: a boolean column on `accounts` (migration 6),
carried on `PublicAccount` -> `GET /auth/me` -> the web `Viewer`. It is granted out-of-band (a DB
update) until the admin console (spec `0037`) ships a toggle. Because insider are ordinary players who
want one login across the game and the subdomain, the session cookie is scoped to a parent **domain**
(`COOKIE_DOMAIN`, `.branchout.games` in prod; host-only in dev, `localhost` in e2e so the flow is
testable across `*.localhost`). Caddy's `insider.branchout.games` block reuses the shared `api_ws` +
`web` snippets, so `/api` and `/ws` stay same-origin per subdomain (no CORS). Admin (spec `0037`) is a
separate static app with its own block; it never reaches this Next middleware.

## Room setup flow and deep link (spec 0029)

Creating a room runs a host wizard - **create -> pick a game -> invite** - rendered by `RoomClient`.
Two kinds of "where am I" state, deliberately kept apart:

- **Create-flow steps are URL-addressable** via `?step=` (`pick`, `invite`; absent = lobby). The page
  server-reads `searchParams.step` into an `initialStep` prop (the same pattern the join page uses),
  and the client owns transitions with `router.replace`, so back/forward and reload are sane. A stale
  `?step=` on a non-host or a running game is cleared once membership resolves.
- **The in-room "Change game" picker is transient local state**, NOT a `?step=`, so reloading or
  sharing a room URL never re-enters the picker.

The **`?game=<slug>` deep link** on `/rooms` is the contract the game feature-page CTA (spec `0030`)
consumes: `slug` is the `GameUiModule.id` (`trivia`, `liar-liar`). On create it is validated against
the web registry (`getGameUi(slug)`) and, if known, selected during creation so the host lands on the
`invite` step (the pick step is skipped); an unknown slug is ignored and falls back to `pick` without
blocking room creation. The per-game display data the picker cards and the feature page both read
(`name`, `tagline`, `summary`, `icon`) lives once on the web game registry, so adding a game stays
"add a module + a registry entry".

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
`GITHUB_TOKEN`, `packages: read`), and writes `deploy/docker/.env.prod` from GitHub secrets.
Server secrets live only in that host env file and in GitHub Actions secrets - never in the repo.
Rollback is a redeploy of an older `sha`; `cleanup-images.yml` bounds image disk use. See
`deploy/README.md` for host setup and secrets.

**CTCT token keepalive (spec 0049).** The subscribe endpoint (spec 0047) mints its Constant Contact
access token lazily from a long-lived refresh token in `.env.prod`; a CTCT device-flow refresh token
can rotate and expire when left idle, and only a real subscribe exercises it, so on a quiet site the
token can die unnoticed. A **daily host cron** (deploy user) runs `deploy/ctct-refresh/ctct-keepalive.sh`
- a wrapper around the `ctct` CLI's `refresh-token` in a container (the box has no Node runtime) - to
exercise it out-of-band, logging OK and emailing a Resend alert on failure. It never prints the token.
On the rare rotation it persists the new token to `.env.prod` atomically (backup + temp file + `mv`) and
flags that `control-plane` must be recreated to load it (no auto-recreate: a rotation is rare and a
force-recreate would blip). Because the deploy rewrites `.env.prod` from GitHub secrets every run,
`CTCT_REFRESH_TOKEN` is **preserved across deploys** - the box's (possibly rotated) value wins and the
secret is only the initial seed, exactly like `ADMIN_ROOT_*` (`CTCT_CLIENT_ID` / `CTCT_LIST_ID` are
stable and stay sourced from secrets). See `deploy/README.md` for install, cron, and device-flow
bootstrap; the confirmed (double) opt-in on the CTCT list is the spec 0047 abuse mitigation to enable
before go-live.

**Zero-downtime rollout (spec 0034).** The deploy no longer recreates containers in place
(`up -d --wait`, which 502s for the seconds a container is down). It uses the **docker-rollout**
plugin (SHA-pinned + checksum-verified on the host) to roll each app service - scale to a second
Compose-indexed instance, wait for its healthcheck, drop the old - while Caddy follows the swap via
**dynamic A-record upstreams** (re-resolving the service alias against Docker DNS every second).
Because the droplet cannot run the whole stack twice, services roll **one at a time, backend first**:
`control-plane` -> `game-engine` -> `web`, so peak memory is baseline + one extra app instance, which
`mem_limit`s cap. Postgres and Redis are never rolled (stateful, single volume; `up -d --no-recreate`).
An unhealthy image fails safe (the old instance keeps serving) and the deploy gates on an end-to-end
`curl` through Caddy (page + `/api`). **Capacity rule:** the host must fit baseline + one extra app
instance + Postgres/Redis + headroom + swap; the caps assume the current droplet's RAM, and `mem_limit`
is a hard OOM-kill ceiling set well above real use (incl. SSR cold start), so it only bounds a runaway,
never trips a healthy roll. The droplet (1 vCPU / 1.9 GiB) has a **2 GiB swapfile** provisioned
(`/swapfile`, in `/etc/fstab`, `vm.swappiness=10`) as an OOM backstop, not for steady paging. Caps are
trimmed so the four app services fit: `web` 320m, `admin` 320m (spec 0037), `control-plane` 256m,
`game-engine` 256m (each `--memory-swap` at 2x), plus Postgres/Redis (~40m). That is ~1152m of app
ceilings; steady real use is well under the caps (an operator-only `admin` is light), and a rollout
adds at most one extra instance (+320m peak) - all backed by the 1.9 GiB RAM + 2 GiB swap. CPU is
near-idle; RAM is the binding constraint for adding services.

**What "follows the swap" does and does not cover.** Caddy's dynamic upstreams re-resolve the alias
for the three edge-fronted routes (`/api` -> control-plane, `/ws` -> game-engine, `*` -> web). Two
hops do **not** pass through Caddy and so are not covered by it: `web` SSR -> `control-plane:4000`
(session/room-preview reads) and `control-plane` -> `game-engine:4001` (the handoff/control client).
Docker DNS re-resolves the alias per new connection, so new requests reach the surviving instance, but
a keep-alive socket pinned to the instance being removed fails once and undici re-dials on the next
attempt - a brief per-connection blip, not sustained downtime. The `--wait-after-healthy` grace plus
the control-plane's report **outbox** (retries) and SSR's short-lived GETs absorb it. Separately,
`/ws` is **not drop-free**: rolling `game-engine` severs in-flight WebSocket sessions, which self-heal
via client reconnect over Redis-backed state - acceptable, but distinct from the seamless `/api`/`*`
paths. **Partial-rollout compatibility:** because services roll separately, a new instance of one
briefly talks to an old instance of another. Adding *optional* fields under the **same**
`PROTOCOL_VERSION` is safe; **do not bump `PROTOCOL_VERSION` in a rollout deploy** - `assertVersion` is
a strict equality check on the cross-service ingress, so a version bump is a hard cutover that needs an
expand/contract (dual-version) rollout, not a single push. `deploy/rollout-rehearsal.sh` is the
automatable proof (hammers Caddy on the page + `/api` during a local rollout and asserts zero drops, a
changed instance, and no dependency churn).

## Build tooling

Turborepo drives `build`/`lint`/`test`/`typecheck`. Shared config (tsconfig, flat ESLint,
Prettier) lives in `packages/config`; the root files re-export it. The `protocol` package and
the two services build with `tsup` (bundled ESM); services run with `tsx` in dev and
`node dist` in prod. `web` builds with `next build` (Tailwind v4 via `@tailwindcss/postcss`).
`packages/protocol` carries both the shared message types and the `ws`-backed transport adapter
behind a transport-agnostic interface, so the realtime transport can change without touching
game logic.

## Testing (spec 0026)

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

- **Player <-> engine (WebSocket).** Client frames `join`, `move`, `vote`; server frames
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
  lifecycle (`configure -> startRound -> collectMove -> reveal -> disputeWindow -> disputeVote
  -> leaderboard -> advance`, plus `endGame`). The engine's composition root builds the services,
  `registerPlugins` instantiates each plugin into the registry and collects its config schema, and
  `/sessions` validates the handoff config against that schema before configuring; the engine still
  sequences phases, timers, streaming, persistence, and reporting while the module owns what each
  phase means. Adding a game is adding its plugin to the boot list; a stub game (an SDK test
  fixture) drives the lifecycle in tests (Trivia is spec `0008`). After `reveal` a game takes one of
  two opt-in post-reveal shapes (spec `0020`): the `disputing -> voting` dispute path (Trivia), or a
  generic **guess** phase - `reveal` returns a `decision`, the engine opens a `guessing` window,
  collects choices via the `vote` frame, then calls `resolveDecision` to score (the shape Liar Liar
  uses). A module may also **reject a single submission** (`collectMove` returns `rejected`): the
  engine replies to that one device with a targeted `move_rejected` frame and writes no state -
  never a broadcast (used for "someone already submitted that" in a bluffing game).
- **Server-authoritative games** (spec `0043`, Teeter Tower). A game's payloads are opaque, so a
  module can own *shared simulation state*, not just per-player answers: Teeter runs Matter.js
  **headless in the engine**, keeps the authoritative tower in `scratch`, and treats one piece-drop
  as one round - `collectMove` takes `{ angle, dropX }`, `reveal` simulates the drop once and streams
  the settle as a keyframe **track** so every client renders the identical tower (the browser runs no
  physics). Determinism (seeded PRNG, fixed timestep, capped steps) keeps the single server sim
  reproducible. **Worker isolation (spec 0045)** closed the original head-of-line-blocking seam: each
  session's module compute now runs in a dedicated worker_thread (see the live-game note above), so a
  heavy settle or physics tick no longer stalls the main event loop or other rooms. A game may declare
  `manifest.visibility: 'insider'`; the web registry hides such games from the public
  picker/pages/sitemap and surfaces them only on the insider SURFACE (feedback `0029`: gated by host
  via `getSurface()`, not by the viewer's entitlement, so an insider on the apex never sees them). A
  follow-up should add the matching control-plane start guard for defence in depth.
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

## Admin console (spec 0037)

The operator console is a **separate Next.js service** (`apps/admin`), served by Caddy at
`admin.branchout.games` - not the `web` process. It is a fourth app service on the droplet with its own
`mem_limit` of **320m** (see the capacity rule above); the swap + trimmed caps (spec 0034) leave the
headroom, and an operator-only surface stays light. It reaches control-plane's `/api` **same-origin** (Caddy's admin block imports the
shared `api` snippet, so it inherits the trusted-client-IP header from spec 0038), and gates
server-side (a `requireAdmin` layout guard) while control-plane re-checks the admin session on every
`/v1/admin/*` call - the authoritative boundary.

Admin is a **separate identity** from players, deliberately: its own `admin_accounts` table (never the
player `accounts`), its own Redis session namespace (`admin_session:`), and a **host-only** cookie
(`branchout_admin_session`, no `Domain`) - so a player/insider session can never satisfy the admin gate
and an admin session never appears on the public site. There is **no public admin signup**: the first
admin is reconciled from `ADMIN_ROOT_EMAIL`/`ADMIN_ROOT_PASSWORD` on boot (env is the source of truth -
break-glass recovery), and further admins are created from within the console. The admin login reuses
the spec 0036 limiter, anchored on the admin account. The console lists players by gamer tag, opens a
profile, and grants/revokes the `insider` role (spec 0035). MFA is a documented follow-up; rate
limiting is the v1 control. `admin` rolls after `web` in the zero-downtime deploy.
