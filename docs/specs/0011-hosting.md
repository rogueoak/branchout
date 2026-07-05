# 0011 - Hosting and deploy (DigitalOcean)

## Problem

Branch out needs to run somewhere real, over HTTPS, and update itself when `main` changes.
Run it on a DigitalOcean droplet at `branchout.games`, behind TLS, with the container images
kept **private** on GHCR, deployed hands-off by GitHub Actions - and with no droplet address or
secret committed to the repo.

Audience: players hitting `branchout.games`; and the maintainer who wants a reproducible,
hands-off deploy and a one-line rollback.

## Outcome

- On push to `main`: `verify` -> `build` (push three private images - `web`, `control-plane`,
  `game-engine` - to GHCR, tagged `sha-<commit>`) -> a `deploy` job SSHes into the droplet as the
  `deploy` user and rolls the whole stack forward to that commit's images.
- Served over HTTPS at `https://branchout.games` (`www` redirects to the apex), certificates
  auto-issued and renewed by a Caddy edge proxy this repo owns.
- Same-origin routing: `branchout.games` serves the web app; `/api/*` reaches the control-plane
  and `/ws/*` the game-engine (WebSocket upgrade). One domain, one certificate, first-party
  session cookie, no CORS.
- Health-gated: `docker compose up -d --wait` only succeeds if the new containers pass their
  healthchecks, so a broken image is a red deploy, not a flapping site.
- Private images: the droplet logs in to GHCR using the deploy run's `GITHUB_TOKEN`
  (`packages: read`) - no long-lived registry token, no public images.
- No hosting secrets in the repo: the droplet address, SSH key, and server secrets live in GitHub
  Actions secrets and a droplet-side env file, never in git.

## Scope

**In:**
- `deploy/docker/compose.proxy.yml` - the Caddy edge proxy: the only stack publishing host ports
  80/443, on a shared external `edge` network, persisting ACME data in a volume.
- `deploy/docker/Caddyfile` - `branchout.games` with auto-TLS + HSTS: `/api/*` -> `control-plane`,
  `/ws/*` -> `game-engine` (WebSocket), everything else -> `web:3000`; `www` -> apex redirect. No
  ACME email in the tracked file (privacy).
- `deploy/docker/compose.site.yml` - the app stack: `web`, `control-plane`, `game-engine` (each
  the private GHCR image at `sha-<commit>`), plus `postgres` and `redis` with named volumes. Only
  the three app services join `edge`; Postgres and Redis stay on an internal network with no host
  port. Server secrets come from an `env_file` written on the host (below).
- `.github/workflows/release.yml` - `verify` -> `build` (matrix over the three apps, push
  `sha-<commit>` + `latest`, package visibility **private**) -> `deploy` (`needs: build`): SSH in,
  `git reset --hard origin/main`, `docker login ghcr.io` with the run's `GITHUB_TOKEN`, ensure the
  `edge` network + proxy (validate the Caddyfile first), write the env file from secrets, `compose
  pull` + `up -d --wait`, then a label-scoped image prune. Plus a `cleanup-images.yml` retention
  workflow.
- `deploy/README.md` - the one-time host prerequisites and the GitHub Actions secrets table.
- A documented **one-time decommission** of whatever stack currently holds 80/443 on this droplet,
  run once by an operator before Branch out's Caddy takes over.

**Out:**
- Staging / multi-environment, blue-green, multi-droplet, and IaC provisioning of the droplet.
- Kubernetes (someday, not now).
- Managed Postgres/Redis and off-host backups - v1 self-hosts both in compose with volumes; note
  both as follow-ups (a nightly `pg_dump` to object storage is the likely next step).

## Approach

Mirror the rogueoak droplet deploy (`../rogueoak` `deploy/docker/` + `release.yml`), extended for a
multi-service app with private images and server secrets.

- **Two stacks on a shared external `edge` network.** The `proxy` stack (Caddy) is the only one
  publishing host ports and terminates TLS; the `site` stack publishes no host port and is reached
  by Caddy as `web:3000` / `control-plane:<port>` / `game-engine:<port>`. Explicit `name:` on each.
  Postgres and Redis sit on a second, internal-only network so nothing but the app can reach them.
- **Same-origin path routing** keeps the `0004` session cookie first-party and removes CORS: the
  web app calls `/api` and `/ws` on its own origin, and Caddy fans them out. The web image is built
  to use same-origin API/WS paths.
- **Private GHCR pull.** `build` pushes with private visibility. `deploy` pipes the run's
  `GITHUB_TOKEN` into `docker login ghcr.io -u <actor> --password-stdin` on the droplet, pulls, then
  logs out - least privilege (`packages: read`), no long-lived token on the host. (Alternative if
  you prefer: a dedicated `read:packages` PAT stored once on the droplet; flagged for your call.)
- **Server secrets** live only in a droplet `env_file` (for example `~deploy/branchout/.env.prod`,
  mode 0600, outside the repo). The deploy writes it each run from GitHub secrets
  (`POSTGRES_PASSWORD`, `SESSION_SECRET`, and any others `0004`/`0006` need), so GitHub is the one
  source of truth and the host file is disposable. Postgres and Redis use named volumes so data
  survives a redeploy; the control-plane runs its migrations on boot.
- **Self-bootstrapping deploy.** The remote script clones the repo to `~deploy/branchout` if
  missing, `git fetch` + `reset --hard origin/main`, `docker network create edge` if absent,
  `caddy validate` before bringing the proxy up (a bad Caddyfile fails the deploy instead of taking
  the edge down), writes the env file, `IMAGE_TAG=sha-<commit>` `compose pull` + `up -d --wait`,
  then a label-scoped `docker image prune -af`.
- **Pinned images + rollback.** The deploy pins `sha-<full-sha>` (auditable); rollback is a redeploy
  with an older sha. A retention workflow keeps the most recent tagged images.
- **SSH** uses `DEPLOY_SSH_KEY` (private key), `DEPLOY_KNOWN_HOSTS` (pinned host key, no
  trust-on-first-use), `DEPLOY_HOST`, `DEPLOY_USER`, with `BatchMode=yes` and a connect timeout.
- **One-time decommission.** This droplet previously cohosted other sites behind a shared Caddy
  proxy. Before Branch out's proxy can bind 80/443, an operator stops and removes the previous
  stacks (old proxy + any leftover site containers) once, by hand, over SSH - a destructive step
  kept out of the automated pipeline. Documented in `deploy/README.md`.

## Acceptance

- [ ] `deploy/docker/` has `compose.proxy.yml`, `compose.site.yml`, and `Caddyfile`; only the proxy
      publishes ports; app services share `edge`; Postgres/Redis have volumes, an internal network,
      and no host port.
- [ ] `release.yml` builds and pushes three **private** GHCR images tagged `sha-<commit>` and
      deploys the pinned images health-gated with `up -d --wait`.
- [ ] The droplet pulls private images by logging in with the run's `GITHUB_TOKEN`; no public
      images and no registry token committed or stored long-lived (unless the PAT alternative is
      chosen).
- [ ] Server secrets come only from a droplet `env_file` written from GitHub secrets; none in the
      repo; the Caddyfile carries no ACME email.
- [ ] `https://branchout.games` serves the app over TLS; `/api` and `/ws` reach the control-plane
      and game-engine same-origin; `www` redirects to the apex.
- [ ] Rollback is a redeploy of an older `sha`; a retention workflow bounds image disk use.
- [ ] The one-time decommission of the prior stack is documented, and after it Branch out owns
      80/443 on the droplet.
