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

## External game data (spec 0041)

The real game banks (Trivia questions, Liar Liar clues) live in a **separate private repo**,
`git@github.com:rogueoak/branchout-data.git`, not in this public repo. The public repo ships only a
tiny valid **sample** (a handful of items per category) so the code, unit tests, and local runs stay
honest; production reads the full bank from the private repo mounted read-only into the containers.

How it wires together:

- **Pinned tag.** `deploy/data.version` holds a bare semver (e.g. `0.1.0`) that is a **git tag** in
  the private repo. To ship new content: tag the private repo (`0.1.1`), then bump `data.version`
  here in a normal PR. The deploy checks out exactly that ref - the content version is pinned in
  git, auditable, and rolls back with the code. The deploy step validates the file (first line only,
  semver/hex charset) before it becomes a checkout ref.
  **Tag mutability.** A git tag can be force-moved, so "pinned + rolls back with the code" holds only
  if the data repo's release tags are **protected against force-move** (a tag-protection rule on
  `rogueoak/branchout-data`, restricting who can move a `*.*.*` tag) - this repo pins its GitHub
  Actions to commit SHAs for exactly this reason. If you cannot protect tags, put a **full 40-char
  commit SHA** in `data.version` instead (the validator accepts it) for a truly immutable pin.
- **The box pulls the data itself.** The droplet clones `rogueoak/branchout-data` at
  `$HOME/branchout-data` and, on every deploy, the remote script fetches and checks out the pinned
  tag from `deploy/data.version`. The box authenticates with a **read-only deploy key** (org deploy
  keys are enabled) via a scoped `github-data` SSH alias (`~/.ssh/config` -> `IdentityFile
~/.ssh/branchout_data_deploy`), so only the data repo uses that key and no cross-repo token is
  needed. The deploy writes `GAME_DATA_HOST` (`$HOME/branchout-data`) into `.env.prod` so compose can
  resolve the host path. The sync is **best-effort**: if GitHub is unreachable or the tag is missing,
  the box keeps its currently checked-out data and the deploy continues (the app deploy is never
  blocked on the data pipeline, and the read-only mount always has the last-good content).
- **Read-only mount.** `compose.site.yml` bind-mounts `${GAME_DATA_HOST}/data` at
  `/srv/game-data/data:ro` into **game-engine** (the real reader; it loads the banks at boot) and
  **admin** (the same mount, for future content moderation), and sets `GAME_DATA_DIR=/srv/game-data`
  on both. The mount is read-only and identical on both docker-rollout instances, so it is compatible
  with the zero-downtime swap.
- **Loader.** With `GAME_DATA_DIR` set, `@branchout/game-sdk`'s fs asset loader reads every game's
  `data/` from the mount instead of the package's bundled sample (the relative paths
  `data/trivia/...` / `data/liar-liar/...` are unchanged, so one mount root serves both games). Unset
  (local dev, tests, e2e), it falls back to the bundled sample.

**One-time host setup** (done once per droplet, so the box can pull the private repo):

```sh
# On the droplet, as the deploy user:
ssh-keygen -t ed25519 -f ~/.ssh/branchout_data_deploy -N "" -C "branchout-data-deploy-box"
cat ~/.ssh/branchout_data_deploy.pub   # register this as a READ-ONLY deploy key on
                                       # rogueoak/branchout-data (Settings -> Deploy keys, no write)
# Scope the key to the data repo only (github.com is otherwise untouched):
printf '\nHost github-data\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/branchout_data_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts   # pin the host key
git clone git@github-data:rogueoak/branchout-data.git ~/branchout-data
```

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

| Secret                | Value                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`      | Private SSH key for the `deploy` user (the public key goes in `~deploy/.ssh/authorized_keys` on the droplet)                |
| `DEPLOY_KNOWN_HOSTS`  | Output of `ssh-keyscan -H <droplet-ip>` (pins the host key; prevents MITM on deploy)                                        |
| `DEPLOY_HOST`         | Droplet IP address or hostname                                                                                              |
| `DEPLOY_USER`         | `deploy`                                                                                                                    |
| `POSTGRES_PASSWORD`   | Strong random password for the Postgres `branchout` user                                                                    |
| `SESSION_SECRET`      | Strong random secret for session signing (spec 0004)                                                                        |
| `ADMIN_ROOT_EMAIL`    | Email of the seeded root admin (spec 0037); optional - unset means no admin yet                                             |
| `ADMIN_ROOT_PASSWORD` | Password for the seeded root admin (min 12 chars); env is the source of truth (break-glass recovery)                        |
| `RESEND_API_KEY`      | Resend API key for host feedback email (spec 0048) and the CTCT keepalive alert (spec 0049); optional                       |
| `CTCT_CLIENT_ID`      | Constant Contact app client_id (spec 0047); stable, sourced from this secret each deploy                                    |
| `CTCT_REFRESH_TOKEN`  | CTCT refresh token; the **initial seed** only - the keepalive rotates it on the box and the deploy preserves it (spec 0049) |
| `CTCT_LIST_ID`        | The "Branch Out Games" CTCT list id (spec 0047); stable, sourced from this secret each deploy                               |

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

## CTCT token keepalive (spec 0049)

The newsletter subscribe endpoint (spec 0047) mints a Constant Contact access token lazily from a
long-lived refresh token in `.env.prod`. A CTCT device-flow refresh token can **rotate and expire when
left idle**, and the subscribe route only exercises it on a real subscribe - so on a quiet site the
token can die with no warning (the first person to subscribe after that hits a 500). A daily host cron
prevents it by exercising the token out-of-band and emailing on failure. This mirrors the cohosted
rogueoak keepalive (its spec 0009).

The refresh logic lives in the `ctct` CLI's `refresh-token` command, run as a container (the box has no
Node runtime); the wrapper `deploy/ctct-refresh/ctct-keepalive.sh` handles logging, atomic persistence
of a rotated token, and the Resend alert. It reads `CTCT_CLIENT_ID` / `CTCT_REFRESH_TOKEN` (and, for
alerts, `RESEND_API_KEY`) from `.env.prod`. Dependencies on the box: `docker` and `python3` (both
present).

**Install (once, on the host, as the `deploy` user):**

```sh
docker pull ghcr.io/mattmaynes/ctct-cli:latest
mkdir -p ~/ctct-refresh
install -m 0755 ~/branchout/deploy/ctct-refresh/ctct-keepalive.sh ~/ctct-refresh/ctct-keepalive.sh
```

The wrapper is installed to `~/ctct-refresh/` (outside the git checkout) so a deploy `git reset --hard`
never disturbs it or its logs. Re-run the `install` line after a change lands in the repo, and
`docker pull ...` again after a new CLI release.

**Schedule the daily cron (deploy user):** pick a fixed UTC time, offset from the rogueoak keepalive so
the two never fire in the same minute, and send stderr to `~/ctct-refresh/cron.err`:

```sh
( crontab -l 2>/dev/null; \
  echo '27 8 * * * /home/deploy/ctct-refresh/ctct-keepalive.sh /home/deploy/branchout/deploy/docker/.env.prod branchout.games >> /home/deploy/ctct-refresh/cron.err 2>&1' \
) | crontab -
```

**Secrets.** `CTCT_CLIENT_ID`, `CTCT_REFRESH_TOKEN`, and `CTCT_LIST_ID` are GitHub Actions secrets
(table above), written into `.env.prod` on each deploy. `CTCT_CLIENT_ID` and `CTCT_LIST_ID` are stable
and always sourced from the secret. `CTCT_REFRESH_TOKEN` is only the **initial seed**: the keepalive can
rotate it on the box, so `release.yml` reads the box's existing value and **preserves it** across
deploys (falling back to the secret only on a first-time box) - exactly like the root admin creds. When
CTCT does rotate the token, the wrapper backs up `.env.prod`, rewrites the `CTCT_REFRESH_TOKEN=` line
atomically, and logs LOUDLY that `control-plane` must be recreated to load it (it does **not**
auto-recreate - a rotation is rare and a force-recreate would cause an unexpected blip):

```sh
cd ~/branchout && docker compose -f deploy/docker/compose.site.yml up -d --force-recreate control-plane
```

**Health check.** Run the wrapper by hand and expect `OK token refreshed` in the log:

```sh
~/ctct-refresh/ctct-keepalive.sh ~/branchout/deploy/docker/.env.prod branchout.games
tail -n 3 ~/ctct-refresh/keepalive.log
```

The wrapper never prints the token; it logs status/error only. Alert to/from default to
`feedback@rogueoak.com` / `branchout@rogueoak.com` and can be overridden with `CTCT_ALERT_TO` /
`CTCT_ALERT_FROM` in `.env.prod`. If `RESEND_API_KEY` is unset the wrapper logs instead of emailing and
never fails the cron on a missing alert channel.

### Bootstrap or re-mint the refresh token (device flow)

Seed the initial `CTCT_REFRESH_TOKEN` secret (and re-mint it if the token ever truly dies - the
keepalive log shows `invalid_grant`) via the CTCT **device flow**. The app is a device-flow public
client (no redirect URI, no secret), so the easiest path is the
[`ctct`](https://github.com/mattmaynes/ctct-cli) CLI:

```sh
ctct init --client-id <constant-contact-app-client-id>
ctct login   # approve the printed verification URL in a browser, then read the stored refresh token
```

Or by hand: POST `client_id` + `scope=contact_data offline_access` to
`https://authz.constantcontact.com/oauth2/default/v1/device/authorize`, approve the returned
`verification_uri_complete` in a browser, then poll
`https://authz.constantcontact.com/oauth2/default/v1/token` with
`grant_type=urn:ietf:params:oauth:grant-type:device_code` until it returns a `refresh_token`. Put the
value in the `CTCT_REFRESH_TOKEN` GitHub secret (the seed) and, on the box, in `.env.prod`; recreate
`control-plane` so it re-reads env.

### Go-live: enable confirmed (double) opt-in

**Before go-live, enable confirmed (double) opt-in on the "Branch Out Games" CTCT list.** This is the
spec 0047 abuse mitigation: the public subscribe endpoint can be POSTed with arbitrary emails, so a
confirmation email (the subscriber must click to confirm) ensures a real, consenting recipient before
they receive newsletter mail. Set it in the Constant Contact console on the list's settings.

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
