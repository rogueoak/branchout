#!/usr/bin/env bash
# Zero-downtime rollout rehearsal (spec 0034). Drives a docker-rollout swap of each app
# service while hammering the site THROUGH Caddy on every routed path, and FAILS if any
# request drops, the rolled instance did not change, or a dependency container churned -
# the automatable proof that a rollout is invisible to visitors.
#
# Run it against a LOCAL copy of the deploy stack, NOT production: bring up the proxy and
# site stacks on the shared `edge` network first (see deploy/README.md), e.g.
#   docker network create edge
#   docker compose -f deploy/docker/compose.proxy.yml up -d --wait
#   IMAGE_TAG=<old> docker compose -f deploy/docker/compose.site.yml up -d --wait
#   IMAGE_TAG=<new> deploy/rollout-rehearsal.sh   # roll from <old> to <new>
#
# Usage: deploy/rollout-rehearsal.sh [service ...]   (default: control-plane game-engine web)
# Env:
#   POLL_URL  page path hammered through Caddy   (default https://branchout.games)
#   API_URL   api path hammered through Caddy    (default https://branchout.games/api/v1/auth/me)
#   RESOLVE   curl --resolve so it hits local Caddy (default branchout.games:443:127.0.0.1)
#   SITE      site compose file                  (default deploy/docker/compose.site.yml)
#
# Note on coverage: continuity is asserted through Caddy on the page (`web`) and REST
# (`/api` -> control-plane) upstreams. The `/ws` upstream is NOT drop-free by design - a
# game-engine roll severs in-flight WebSocket sessions, which self-heal via client reconnect
# over Redis-backed state - so it is not hammered here. Asserting the *served build id*
# through Caddy would need a public version endpoint (none exists yet); the instance-changed
# check below stands in for "a new instance is live" and is an honest, documented proxy.
set -euo pipefail

SITE="${SITE:-deploy/docker/compose.site.yml}"
POLL_URL="${POLL_URL:-https://branchout.games}"
API_URL="${API_URL:-https://branchout.games/api/v1/auth/me}"
RESOLVE="${RESOLVE:-branchout.games:443:127.0.0.1}"
services=("$@")
[ ${#services[@]} -gt 0 ] || services=(control-plane game-engine web)

command -v docker >/dev/null || {
  echo "docker not found"
  exit 1
}
docker rollout --help >/dev/null 2>&1 ||
  {
    echo "docker-rollout plugin not installed (see .github/workflows/release.yml)"
    exit 1
  }

# Space-separated, sorted container ids for a service's live instances.
instances() { docker compose -f "$SITE" ps -q "$1" | sort | tr '\n' ' '; }

# Container ids of every service EXCEPT the one being rolled - the dependency/neighbour set
# that a single-service rollout must leave untouched (proves docker-rollout's `--no-deps`).
others() {
  local rolling="$1" svc ids=""
  for svc in $(docker compose -f "$SITE" config --services); do
    [ "$svc" = "$rolling" ] && continue
    ids="$ids$(instances "$svc")"
  done
  echo "$ids"
}

fail=0
for svc in "${services[@]}"; do
  echo "== rehearsing rollout: $svc =="
  before="$(instances "$svc")"
  [ -n "$before" ] || {
    echo "  $svc is not running; bring the stack up first"
    exit 1
  }
  deps_before="$(others "$svc")"

  # Hammer the public paths back-to-back (no sleep) so the narrow sub-second window between
  # old-instance removal and Caddy's next 1s DNS refresh is densely sampled. Count a failure
  # if EITHER the page or the REST path fails, so a broken dynamic upstream on the rolled
  # service's route is caught through Caddy - not just out-of-band.
  stop="$(mktemp)"
  counts="$(mktemp)"
  (
    total=0
    bad=0
    while [ -e "$stop" ]; do
      total=$((total + 1))
      if ! curl -fsS --max-time 5 --resolve "$RESOLVE" -o /dev/null "$POLL_URL" ||
        ! curl -fsS --max-time 5 --resolve "$RESOLVE" -o /dev/null "$API_URL"; then
        bad=$((bad + 1))
      fi
    done
    echo "$bad $total" >"$counts"
  ) &
  loop=$!

  # Capture the rollout's exit WITHOUT aborting the script (set -e), so cleanup below always
  # runs - a failed rollout must still stop the hammer loop and free the temp files, and be
  # recorded as a failure rather than orphaning the background loop.
  rc=0
  docker rollout -t 90 --wait-after-healthy 5 -f "$SITE" "$svc" || rc=$?

  rm -f "$stop" # signal the loop to finish its current request and exit
  wait "$loop"  # NOT `|| true`: a crashed hammer must surface, not be masked
  read -r bad total <"$counts"
  rm -f "$counts"
  after="$(instances "$svc")"
  deps_after="$(others "$svc")"

  echo "  requests: $total, failed: $bad"
  echo "  instances before: $before"
  echo "  instances after:  $after"
  [ "$rc" -eq 0 ] || {
    echo "  FAIL: docker rollout for $svc exited $rc"
    fail=1
  }
  [ "$bad" -eq 0 ] || {
    echo "  FAIL: $bad dropped request(s) during the $svc rollout"
    fail=1
  }
  # The rolled instance must actually change - a no-op rollout would trivially pass the
  # zero-drop check. Container id stands in for "a new instance is live" (an honest proxy for
  # served build id, which would need a public version endpoint - see the header note).
  [ "$before" != "$after" ] || {
    echo "  FAIL: $svc instance did not change - rollout was a no-op"
    fail=1
  }
  # A single-service rollout must not churn any dependency/neighbour (docker-rollout --no-deps).
  [ "$deps_before" = "$deps_after" ] || {
    echo "  FAIL: rolling $svc changed other services' containers (dependency churn)"
    fail=1
  }
done

if [ "$fail" -eq 0 ]; then
  echo "PASS: every rollout served continuously, swapped the instance, and left neighbours untouched"
else
  echo "REHEARSAL FAILED"
  exit 1
fi
