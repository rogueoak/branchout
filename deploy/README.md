# Deploy

Branch out runs as four app containers (`web`, `control-plane`, `game-engine`, `admin`) plus Postgres
and Redis on a DigitalOcean droplet at `branchout.games`, behind a Caddy edge proxy that terminates
TLS. Deploys are automatic: every push to `main` runs `.github/workflows/release.yml`
(verify -> build -> deploy), which SSHes into the droplet and rolls the site forward to the
private GHCR images built for that commit (`ghcr.io/rogueoak/branchout/<app>:sha-<commit>`),
**one app service at a time with zero downtime** (see below).

## Stacks (`deploy/docker/`)

Two compose stacks, one shared external Docker network (`edge`):

- `compose.proxy.yml` - the **proxy** stack. Caddy, the only container publishing host ports
  80/443. Terminates TLS (auto-ACME), enforces HSTS, and routes by path:
  `/api/*` -> `control-plane:4000`, `/ws/*` -> `game-engine:4001` (WebSocket upgrade),
  everything else -> `web:3000`. ACME data persists in the `caddy_data` named volume.
  On the `/api` upstream Caddy **replaces** `X-Forwarded-For` with the real client IP so
  `control-plane`'s `request.ip` (its rate limiting) cannot be forged (spec 0038). **This assumes
  Caddy is the direct TLS terminator.** Putting a proxy/load balancer (e.g. a DO load balancer) in
  front of Caddy makes `{remote_host}` the LB's IP, collapsing every client into one rate-limit
  bucket - you must reconfigure the trusted hop (and `trustProxy`) at the same time.

- `compose.site.yml` - the **branchout** app stack. The four private GHCR images plus
  `postgres:16-alpine` and `redis:7-alpine`. No host port is published: Caddy reaches
  the app services over the external `edge` network. Postgres and Redis are on an
  internal-only `db` network; they are not reachable from the host or from Caddy.

Server secrets (Postgres password, session secret) live in `deploy/docker/.env.prod`
on the host (next to `compose.site.yml`, where `env_file: .env.prod` resolves). The
deploy job writes this file fresh from GitHub secrets on every run (mode 0600, readable
only by the deploy user). It is gitignored and never committed.

## Zero-downtime rollout (spec 0034)

Deploys use the [docker-rollout](https://github.com/Wowu/docker-rollout) plugin so a push
never drops a request. For each **app** service the plugin scales it to a second
Compose-indexed instance (`branchout-web-1` / `-2`), waits for the new one's `HEALTHCHECK`,
holds a short grace, then removes the old - so a live backend always exists. Caddy uses
**dynamic A-record upstreams** (re-resolving the service alias against Docker DNS `127.0.0.11`
every second), so it follows the swap instead of pinning the old container's IP.

The droplet is small, so we **cannot run the whole stack twice**. The rollout therefore goes
**one service at a time, backend first**: `control-plane` -> `game-engine` -> `web`. Peak
memory is baseline + a single extra app instance, never 2x everything. `mem_limit` on each app
service caps that transient instance so a leak during the overlap cannot OOM the box.

- **Data tier is never rolled.** Postgres and Redis are stateful singletons on one volume; the
  deploy brings them up with `up -d --no-recreate` (a no-op when unchanged) and rolls only the
  three app services. Rolling a single app service must not recreate its dependencies - this rests
  on docker-rollout scaling with `--no-deps` so `depends_on: service_healthy` does not pull a
  neighbour into the swap; the rehearsal asserts no dependency container churns as a guard.
- **Fail-safe.** An image that pulls but never goes healthy makes docker-rollout tear the _new_
  instance down and leave the old serving, failing the deploy non-zero. The deploy also gates on
  an end-to-end `curl` through Caddy (over loopback) on both the page and `/api`, so a routing
  regression on either dynamic upstream fails the deploy.
- **Not every path is drop-free.** The `/api` and `*` (page) routes are seamless. Two internal
  hops bypass Caddy (`web` SSR -> `control-plane`, `control-plane` -> `game-engine`) and can see a
  single per-connection blip when a keep-alive socket to the removed instance is re-dialed (absorbed
  by the grace window, SSR's short GETs, and the report outbox). And `/ws` is **not** drop-free:
  rolling `game-engine` severs in-flight WebSocket sessions, which self-heal via client reconnect
  over Redis-backed state.
- **Partial-rollout compatibility.** Because services roll one at a time, a new instance of one
  briefly talks to an old instance of another. Adding _optional_ fields under the **same**
  `PROTOCOL_VERSION` is safe. **Do not bump `PROTOCOL_VERSION` in a rollout deploy:** `assertVersion`
  is a strict equality check on the cross-service ingress, so a version bump is a hard cutover that
  needs an expand/contract (two-phase, dual-version) deploy, not a single push.

The plugin is installed on the host by the deploy job, **SHA-pinned and checksum-verified**
before use (it is a shell script run during a privileged deploy).

**Manual rollout** (on the host, e.g. to redeploy a specific tag):

```
cd ~/branchout
IMAGE_TAG=sha-<commit> docker compose -f deploy/docker/compose.site.yml pull
IMAGE_TAG=sha-<commit> docker compose -f deploy/docker/compose.site.yml up -d --no-recreate postgres redis
for s in control-plane game-engine web; do
  IMAGE_TAG=sha-<commit> docker rollout -t 90 --wait-after-healthy 5 -f deploy/docker/compose.site.yml "$s"
done
```

**Rehearsal.** `deploy/rollout-rehearsal.sh` drives a rollout against a _local_ copy of the
deploy stack while hammering the site through Caddy, and fails if any request drops or the
rolled instance did not change - the automatable proof that the swap is invisible. Bring up the
proxy + site stacks on the `edge` network first (see the script header), then run it.

## Host prerequisites (one-time setup)

A fresh droplet needs:

1. **Docker Engine + Compose** installed and running.

   ```
   curl -fsSL https://get.docker.com | sh
   ```

2. A **`deploy` user** in the `docker` group:

   ```
   adduser --disabled-password --gecos "" deploy
   usermod -aG docker deploy
   ```

3. The deploy **public key** in `/home/deploy/.ssh/authorized_keys` (the matching
   private key goes in the `DEPLOY_SSH_KEY` GitHub secret).

4. **Firewall** open on ports 22 (SSH), 80 (HTTP), and 443 (HTTPS/QUIC).

5. **DNS**: `A` records for `branchout.games` and `www.branchout.games` pointing at the
   droplet IP. Caddy needs this to issue TLS certificates via ACME (Let's Encrypt).
   Add an `insider.branchout.games` `A` record too (spec 0035): its Caddyfile block reuses the
   shared `api_ws` + `web` snippets and is served by the same `web` process, but Caddy still issues a
   per-host TLS cert, so the record must resolve to the droplet. For one login to span the apex and
   the insider subdomain, the session cookie must be scoped to the parent domain: set
   `COOKIE_DOMAIN=.branchout.games` in `deploy/docker/.env.prod` (unset elsewhere keeps it host-only).
   Add an `admin.branchout.games` `A` record too (spec 0037): its Caddyfile block imports the shared
   `api` snippet and proxies the rest to the separate `admin` Next.js service. The admin session is a
   distinct, host-only cookie, so it never leaves this origin.

   **Root admin (spec 0037).** The admin console has no public signup; the first admin is seeded from
   env on control-plane boot. Set the `ADMIN_ROOT_EMAIL` / `ADMIN_ROOT_PASSWORD` repo secrets (below);
   the deploy writes them into `.env.prod` and the boot reconcile upserts that admin's password (env is
   the source of truth - a break-glass recovery). Leave them unset and the console simply has no admin
   yet. Further admins are created from within the console. Never commit the values.

6. **GHCR packages set to private**: after the first build pushes the images, go to
   `https://github.com/orgs/rogueoak/packages` and set each of `branchout/web`,
   `branchout/control-plane`, and `branchout/game-engine` to **Private**. The deploy
   job pulls them with a run-scoped `GITHUB_TOKEN` (packages:read) - no long-lived
   token is stored on the host.

The deploy job is self-bootstrapping: it clones the repo to `~/branchout` on first run,
creates the `edge` network, validates the Caddyfile, brings up the proxy, writes the env
file from secrets, and rolls forward the app stack - no manual steps are needed after the
prerequisites above.

## One-time decommission of the coming-soon stack

**An operator must run this once over SSH, before the first real deploy.**

The droplet currently serves a coming-soon page from a separate compose stack that holds
ports 80/443. Branch out's Caddy proxy cannot bind those ports until the existing stack
is stopped. Do NOT run this from the automated pipeline.

```sh
# SSH to the droplet as an admin user (not `deploy`), then:
docker compose -f ~/branchout/coming-soon/compose.yml down
```

Verify the ports are free:

```sh
ss -tlnp | grep -E ':80|:443'
```

Once 80/443 are free, the first `release.yml` run (or a manual `workflow_dispatch`)
brings up Caddy and the full site.

## GitHub Actions secrets

Set under **Settings -> Secrets and variables -> Actions** in the rogueoak/branchout repo:

| Secret                | Value                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DEPLOY_SSH_KEY`      | Private SSH key for the `deploy` user (the public key goes in `~deploy/.ssh/authorized_keys` on the droplet) |
| `DEPLOY_KNOWN_HOSTS`  | Output of `ssh-keyscan -H <droplet-ip>` (pins the host key; prevents MITM on deploy)                         |
| `DEPLOY_HOST`         | Droplet IP address or hostname                                                                               |
| `DEPLOY_USER`         | `deploy`                                                                                                     |
| `POSTGRES_PASSWORD`   | Strong random password for the Postgres `branchout` user                                                     |
| `SESSION_SECRET`      | Strong random secret for session signing (spec 0004)                                                         |
| `ADMIN_ROOT_EMAIL`    | Email of the seeded root admin (spec 0037); optional - unset means no admin yet                              |
| `ADMIN_ROOT_PASSWORD` | Password for the seeded root admin (min 12 chars); env is the source of truth (break-glass recovery)         |

Generate strong values with:

```sh
openssl rand -base64 32   # run once for POSTGRES_PASSWORD, once for SESSION_SECRET
```

### Analytics key (spec 0032)

PostHog product analytics is off unless the project key is configured. It is a **repo variable**, not a
secret (the PostHog project key is publishable - it ships in the browser bundle), and it is baked into
the web image at **build** time (a `NEXT_PUBLIC_*` value), so set it before a deploy that should have
analytics:

```sh
gh variable set NEXT_PUBLIC_POSTHOG_KEY -b 'phc_...'   # Settings -> Secrets and variables -> Actions -> Variables
```

Unset -> the bundle builds with analytics disabled (a safe no-op, same as dev/e2e). The browser sends
analytics to the same-origin `/ingest` path (first-party); Next rewrites it to PostHog (US), and the
Caddy edge routes `/ingest` to `web` like any non-`/api`/`/ws` path - no proxy change needed.

## Rollback

Rollback is a redeploy of an older image. Options:

1. **Re-run the release workflow** for an older commit (GitHub UI: Actions -> release ->
   find the older run -> Re-run all jobs).

2. **Manual rollback on the droplet** (faster) - roll back to the old tag with the same
   zero-downtime rollout used to deploy (see "Zero-downtime rollout" above):
   ```sh
   cd ~/branchout
   export IMAGE_TAG=sha-<old-commit-sha>
   docker compose -f deploy/docker/compose.site.yml pull
   for s in control-plane game-engine web; do
     docker rollout -t 90 --wait-after-healthy 5 -f deploy/docker/compose.site.yml "$s"
   done
   ```

`cleanup-images.yml` retains the 30 most recent tagged images per package, giving ~30
commits of rollback headroom. If you need to protect a specific sha from pruning, pull
it manually first (it will be "in use" and kept by the prune filter).

## Database and backups

Postgres data lives in the `postgres_data` named volume on the host. It survives
redeploys. The control-plane runs its forward-only migrations on boot.

Backups are a follow-up: a nightly `pg_dump` to DigitalOcean Spaces is the likely next
step. Until then, take manual snapshots before destructive schema changes.
