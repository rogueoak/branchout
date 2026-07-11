# 0034 - Zero-downtime deploys (docker-rollout, one service at a time)

> Independent infra change - updates the deploy pipeline from spec `0011`. It does not block the
> `0027`-`0033` feature batch and can build in its own PR whenever. It does touch
> `deploy/docker/Caddyfile`, which spec `0033` also edits, so sequence it after `0033` to avoid a
> conflict.

## Problem

Every deploy currently causes a brief outage. `release.yml` rolls the app stack forward with
`docker compose -f compose.site.yml up -d --wait`, which **recreates** the changed containers in
place: for the seconds between "old container stopped" and "new container healthy", Caddy has no
backend and visitors get 502s. We want **zero-downtime deploys**, the way `../matthewmaynes` does it
(spec 0019 there) with the **docker-rollout** plugin - scale a service to a second instance, wait for
the new one's healthcheck, then remove the old, so a live backend always exists.

The catch is capacity. That site is a single `site` service; Branch out runs **three** app services
(`web`, `control-plane`, `game-engine`) plus Postgres and Redis on one small droplet. We **cannot
afford to run everything twice at once**. So the rollout must double **one service at a time**:
control-plane, then game-engine (the backend, sequentially), then web (the frontend) - keeping peak
memory at baseline + a single extra instance, never 2x the whole stack.

## Outcome

- A deploy rolls each **app service** with docker-rollout **sequentially** - `control-plane`, then
  `game-engine`, then `web` - so only one service is doubled at any moment and the box never runs the
  whole stack twice.
- Postgres and Redis are **never rolled** (stateful singletons on a single data volume); they stay on
  a plain `up -d` that is a no-op when unchanged.
- Caddy always has a live backend for each route throughout a deploy: it resolves the service alias
  dynamically and follows the swap, so no request 502s mid-deploy.
- A broken (unhealthy) image **fails safe**: docker-rollout tears the new instance back down and the
  old one keeps serving; the deploy exits non-zero without taking the site down.
- Each app service carries a **memory bound** so a rollout's brief second instance can never OOM the
  droplet and take neighbours (or the other two services) down.
- The deploy is gated on a **full public-path** health check (through Caddy over loopback), not just
  the container healthcheck, so a routing/upstream misconfig fails the deploy instead of silently
  502-ing users.

## Scope

In:

- **`deploy/docker/compose.site.yml`**:
  - Remove `container_name` from `web`, `control-plane`, and `game-engine` (docker-rollout runs
    Compose-indexed instances like `branchout-web-1` / `-2` during a swap; a fixed name blocks the
    overlap). Each service keeps its network alias (`web`/`control-plane`/`game-engine`) so Docker DNS
    resolves callers to whichever instances are live. **Keep** `container_name` on `postgres`/`redis`
    (not rolled).
  - Add `mem_limit` + `mem_reservation` to each app service, sized above its real footprint (the
    cohosted-OOM lesson from matthewmaynes feedback 0015), so the transient second instance is capped.
  - Keep the existing healthchecks (docker-rollout waits on them); confirm `start_period` covers real
    boot (migrations run on control-plane boot).
  - Review `depends_on: condition: service_healthy` interaction with a single-service rollout
    (docker-rollout uses `--no-recreate`, so rolling `web` must not recreate `control-plane`); adjust
    if it forces unwanted recreation.
- **`.github/workflows/release.yml`** (deploy job):
  - Install the **docker-rollout** plugin **SHA-pinned + checksum-verified** (verify-then-exec into
    `~/.docker/cli-plugins`), reusing the matthewmaynes hardening (pinned `ROLLOUT_SHA` + `sha256`,
    `--proto =https`, bounded `--max-time`, `trap` cleanup) - it is a shell script run during a
    privileged deploy, so it is treated as supply chain.
  - Replace `up -d --wait` for the app stack with: `pull` all images, ensure Postgres/Redis are up
    (`up -d --no-recreate postgres redis`), then **`docker rollout` each app service in order**:
    `control-plane` -> `game-engine` -> `web` (with `-t` timeout and `--wait-after-healthy` grace so
    Caddy's DNS refresh sees the new instance before the old is removed).
  - After the rollouts, gate on an **end-to-end** check: `curl` `https://branchout.games` through
    Caddy via `--resolve ...:443:127.0.0.1`, retried, and fail the deploy if it is not reachable.
  - Keep the label-scoped image prune.
- **`deploy/docker/Caddyfile`**: switch the three upstreams (`/api/*` -> control-plane, `/ws/*` ->
  game-engine, `*` -> web) to **dynamic upstreams** that re-resolve the service alias against Docker's
  embedded DNS (`127.0.0.11`), so Caddy follows each swap instead of pinning the old container's IP at
  startup. (Coordinate with the `0033` Caddy edit.)
- **`deploy/README.md`** + a capacity note in **`overview/architecture.md`**: document the
  one-service-at-a-time rollout, the ordering and why (backend before frontend), the no-roll rule for
  Postgres/Redis, the memory budget (baseline + one extra instance must fit with headroom + swap), and
  the manual `docker rollout` command for an operator.
- A **local rehearsal** the change can be proven with (see Approach): a script that drives a rollout
  against the local site stack while looping requests through Caddy and asserts zero failed responses.

Out:

- **Rolling Postgres or Redis**, or any HA/replication for the data tier - single instance, single
  volume; a rolling database is a different, much larger problem.
- **Autoscaling, multi-host, or an orchestrator** (Kubernetes/Swarm) - still one droplet, Compose.
- **Breaking cross-service protocol changes during a partial rollout.** Because services roll one at a
  time, a new instance of one briefly talks to an old instance of another; compatibility rests on the
  versioned protocol envelope + additive-field discipline (see learnings, spec `0033`). A genuinely
  breaking change needs an expand/contract two-phase deploy - out of scope here, but called out in the
  docs so it is a conscious choice, not a surprise.
- **The first production cutover** from the current in-place deploy to the rollout deploy is
  operator-observed (like spec `0011`'s first cutover); this spec makes it zero-downtime and fail-safe
  but the initial switch is watched by hand.
- Changing app behavior, images, or the `edge`/`db` network split.

## Approach

- **Roll one service at a time, backend then frontend.** docker-rollout doubles exactly the service
  it is rolling; running it sequentially (`control-plane` -> `game-engine` -> `web`) means peak memory
  is baseline + one extra app instance, never the whole stack twice - the only shape that fits the
  droplet. Frontend last so `web` rolls against an already-updated backend. Postgres/Redis sit still.
- **Dynamic DNS is what makes the swap invisible.** Two things resolve a rolled service by alias:
  Caddy (edge routing) and `web`'s SSR calls to `control-plane`. Docker's embedded DNS returns the
  live instance(s); with a short `--wait-after-healthy` grace the old instance is only removed once
  the new is healthy and discoverable, so neither Caddy nor `web` ever points at nothing. Caddy needs
  **dynamic upstreams** to re-resolve (its default resolves once at start); `web`'s per-request fetch
  already re-resolves. (Verify undici keep-alive to a removed control-plane instance recovers within a
  request or two; the grace window is sized to cover it.)
- **Fail-safe by construction.** An image that pulls but never goes healthy makes docker-rollout
  remove the *new* instance and leave the old serving, exiting non-zero - a bad build cannot black out
  the site. The pre-pull step catches a non-pullable tag before anything swaps. The end-to-end curl
  gate catches a routing/upstream regression the container healthcheck cannot see.
- **Memory bounds are a safety cap, not a tuning knob.** Size `mem_limit` well above each service's
  real footprint so it never trips in normal operation and only caps a runaway/leak during the
  double-up window; document that the host must fit baseline + one extra instance + headroom + swap.
- **Supply-chain the plugin.** docker-rollout is a shell script executed on the host during a
  privileged deploy; pin it to a commit SHA, checksum-verify before making it executable, and only
  exec after the checksum passes - identical posture to the SHA-pinned Actions.
- **Prove it locally, then watch the first prod cutover.** A real zero-downtime claim needs a running
  stack, which the unit harness cannot provide; the rehearsal script (roll a service while curling
  through Caddy in a tight loop, assert 100% success and that the served build id changes) is the
  automatable proof, and the first production deploy is operator-observed. This satisfies the
  large-feature test rule at the layer the behavior actually lives.

## Acceptance

- [ ] A deploy rolls `control-plane`, then `game-engine`, then `web` with docker-rollout, one at a
      time; Postgres and Redis are not rolled (plain `up -d --no-recreate`).
- [ ] The three app services have no `container_name` and each has a `mem_limit`/`mem_reservation`;
      Postgres/Redis keep their names.
- [ ] Caddy uses dynamic upstreams for all three routes and keeps serving each route (no 502) while a
      service is mid-rollout.
- [ ] The docker-rollout plugin is installed SHA-pinned and checksum-verified before use; a failed
      checksum aborts the deploy.
- [ ] An unhealthy new image leaves the old instance serving and fails the deploy non-zero (fail-safe),
      proven in the local rehearsal.
- [ ] The deploy gates on an end-to-end curl through Caddy and fails if the site is not reachable.
- [ ] The local rehearsal drives a rollout while looping requests through Caddy and records zero
      failed responses and a changed served build id.
- [ ] `deploy/README.md` and `overview/architecture.md` document the ordering, the no-roll data tier,
      the memory budget, and the partial-rollout compatibility constraint.
</content>
