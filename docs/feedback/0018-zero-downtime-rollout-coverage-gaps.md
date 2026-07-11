# 0018 - Zero-downtime rollout: coverage and rehearsal-rigor gaps (review of spec 0034)

## Symptom

Persona review of PR #45 (spec `0034`, docker-rollout zero-downtime deploys) surfaced no broken code
but four `major` gaps in the accuracy and rigor of the claim:

- The "Caddy dynamic upstreams follow the swap" story covered only the three edge-fronted routes and
  silently ignored the two internal server-to-server hops (`web` SSR -> `control-plane`,
  `control-plane` -> `game-engine`) that never pass through Caddy.
- The partial-rollout compatibility caveat conflated "additive fields under the same version" (safe)
  with "a version bump" (a hard cutover), even though `assertVersion` is a strict-equality gate.
- The rehearsal script's no-op guard checked the swapped container id out-of-band (`docker compose
  ps`) rather than observing continuity/identity through Caddy, and hammered a single route with a
  `sleep 0.1` cadence that could miss the sub-second swap window.
- A failed `docker rollout` under `set -e` aborted the rehearsal before its cleanup, orphaning the
  background curl loop and leaking temp files.

## Root cause

The zero-downtime design reasoned about the load-balanced (Caddy) paths and under-specified everything
that does not traverse the balancer - internal hops, WebSocket in-flight sessions, and the exact
compatibility boundary of the version stamp. The verification (rehearsal) proved "a rollout completed
and a container changed," not "the guarantee held on the path a user actually takes."

## Fix

- Docs (`architecture.md`, `deploy/README.md`) now state exactly what "follows the swap" covers: the
  three Caddy routes are seamless; the two internal hops see at most a single per-connection re-dial
  blip (absorbed by the grace window, SSR's short GETs, and the report outbox); `/ws` is explicitly
  **not** drop-free (self-heals via reconnect over Redis). The compat caveat now says: additive under
  the same `PROTOCOL_VERSION` is safe, **do not bump `PROTOCOL_VERSION` in a rollout deploy** (needs
  expand/contract).
- The rehearsal hammers Caddy on both the page and `/api` (all drop-free upstreams) back-to-back (no
  sleep), asserts zero drops + a changed instance + **no dependency container churn** (guards the
  `--no-deps` assumption), and captures the rollout exit without aborting so cleanup always runs.
- The production deploy's end-to-end gate now probes the page **and** `/api`, so a broken control-plane
  upstream fails the deploy (hitting only `/` would pass a broken `/api`).

## Learning

Two durable rules, rolled into `overview/learnings.md`:

1. **A zero-downtime claim must account for every connection, not just the ones through the load
   balancer.** Internal service-to-service hops, keep-alive sockets, and stateful long-lived
   connections (WebSockets) each have their own continuity story; enumerate them and say which are
   seamless, which blip-and-retry, and which drop-and-reconnect - "Caddy follows the swap" only covers
   the edge.
2. **A rolling deploy's compatibility window is bounded by the strictness of its version check.** With
   a strict-equality version gate, additive-under-the-same-version is safe but any version bump is a
   hard cutover requiring expand/contract - state that boundary, do not hand-wave "relies on the
   versioned envelope."

And a test-rigor reminder (already in the seam/real-stack learnings): a rehearsal must observe the
guarantee through the same path users take and probe every upstream, and a cleanup path under `set -e`
must capture the failing command's exit rather than let it abort mid-teardown.
