# Deploy

Branch out runs as three containers (`web`, `control-plane`, `game-engine`) plus Postgres and
Redis on a DigitalOcean droplet at `branchout.games`, behind a Caddy edge proxy that terminates
TLS. Deploys are automatic: every push to `main` runs `.github/workflows/release.yml`
(verify -> build -> deploy), which SSHes into the droplet and rolls the site forward to the
private GHCR images built for that commit (`ghcr.io/rogueoak/branchout/<app>:sha-<commit>`).

## Stacks (`deploy/docker/`)

Two compose stacks, one shared external Docker network (`edge`):

- `compose.proxy.yml` - the **proxy** stack. Caddy, the only container publishing host ports
  80/443. Terminates TLS (auto-ACME), enforces HSTS, and routes by path:
  `/api/*` -> `control-plane:4000`, `/ws/*` -> `game-engine:4001` (WebSocket upgrade),
  everything else -> `web:3000`. ACME data persists in the `caddy_data` named volume.

- `compose.site.yml` - the **branchout** app stack. The three private GHCR images plus
  `postgres:16-alpine` and `redis:7-alpine`. No host port is published: Caddy reaches
  the app services over the external `edge` network. Postgres and Redis are on an
  internal-only `db` network; they are not reachable from the host or from Caddy.

Server secrets (Postgres password, session secret) live in `deploy/docker/.env.prod`
on the host (next to `compose.site.yml`, where `env_file: .env.prod` resolves). The
deploy job writes this file fresh from GitHub secrets on every run (mode 0600, readable
only by the deploy user). It is gitignored and never committed.

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

| Secret               | Value                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DEPLOY_SSH_KEY`     | Private SSH key for the `deploy` user (the public key goes in `~deploy/.ssh/authorized_keys` on the droplet) |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -H <droplet-ip>` (pins the host key; prevents MITM on deploy)                         |
| `DEPLOY_HOST`        | Droplet IP address or hostname                                                                               |
| `DEPLOY_USER`        | `deploy`                                                                                                     |
| `POSTGRES_PASSWORD`  | Strong random password for the Postgres `branchout` user                                                     |
| `SESSION_SECRET`     | Strong random secret for session signing (spec 0004)                                                         |

Generate strong values with:

```sh
openssl rand -base64 32   # run once for POSTGRES_PASSWORD, once for SESSION_SECRET
```

## Rollback

Rollback is a redeploy of an older image. Options:

1. **Re-run the release workflow** for an older commit (GitHub UI: Actions -> release ->
   find the older run -> Re-run all jobs).

2. **Manual rollback on the droplet** (faster):
   ```sh
   IMAGE_TAG=sha-<old-commit-sha> \
     docker compose -f ~/branchout/deploy/docker/compose.site.yml pull
   IMAGE_TAG=sha-<old-commit-sha> \
     docker compose -f ~/branchout/deploy/docker/compose.site.yml up -d --wait
   ```

`cleanup-images.yml` retains the 30 most recent tagged images per package, giving ~30
commits of rollback headroom. If you need to protect a specific sha from pruning, pull
it manually first (it will be "in use" and kept by the prune filter).

## Database and backups

Postgres data lives in the `postgres_data` named volume on the host. It survives
redeploys. The control-plane runs its forward-only migrations on boot.

Backups are a follow-up: a nightly `pg_dump` to DigitalOcean Spaces is the likely next
step. Until then, take manual snapshots before destructive schema changes.
