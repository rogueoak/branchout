#!/usr/bin/env bash
# Zero-downtime rollout rehearsal (spec 0034). Drives a docker-rollout swap of each app
# service while hammering the site through Caddy, and FAILS if any request drops or the
# rolled instance did not actually change - the automatable proof that a rollout is
# invisible to visitors.
#
# Run it against a LOCAL copy of the deploy stack, NOT production: bring up the proxy and
# site stacks on the shared `edge` network first (see deploy/README.md), e.g.
#   docker network create edge
#   docker compose -f deploy/docker/compose.proxy.yml up -d --wait
#   IMAGE_TAG=<tag> docker compose -f deploy/docker/compose.site.yml up -d --wait
#   deploy/rollout-rehearsal.sh
#
# Usage: deploy/rollout-rehearsal.sh [service ...]   (default: control-plane game-engine web)
# Env:
#   POLL_URL  URL to hammer through Caddy   (default https://branchout.games)
#   RESOLVE   curl --resolve so it hits local Caddy (default branchout.games:443:127.0.0.1)
#   SITE      site compose file             (default deploy/docker/compose.site.yml)
set -euo pipefail

SITE="${SITE:-deploy/docker/compose.site.yml}"
POLL_URL="${POLL_URL:-https://branchout.games}"
RESOLVE="${RESOLVE:-branchout.games:443:127.0.0.1}"
services=("$@")
[ ${#services[@]} -gt 0 ] || services=(control-plane game-engine web)

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker rollout --help >/dev/null 2>&1 ||
  { echo "docker-rollout plugin not installed (see .github/workflows/release.yml)"; exit 1; }

# Space-separated, sorted container ids for a service's live instances.
instances() { docker compose -f "$SITE" ps -q "$1" | sort | tr '\n' ' '; }

fail=0
for svc in "${services[@]}"; do
  echo "== rehearsing rollout: $svc =="
  before="$(instances "$svc")"
  [ -n "$before" ] || { echo "  $svc is not running; bring the stack up first"; exit 1; }

  # Hammer the public path in the background, counting failures, until told to stop.
  stop="$(mktemp)"; counts="$(mktemp)"
  (
    total=0; bad=0
    while [ -e "$stop" ]; do
      total=$((total + 1))
      curl -fsS --max-time 5 --resolve "$RESOLVE" -o /dev/null "$POLL_URL" || bad=$((bad + 1))
      sleep 0.1
    done
    echo "$bad $total" >"$counts"
  ) &
  loop=$!

  docker rollout -t 90 --wait-after-healthy 5 -f "$SITE" "$svc"

  rm -f "$stop"        # signals the loop to finish its current request and exit
  wait "$loop" 2>/dev/null || true
  read -r bad total <"$counts"; rm -f "$counts"
  after="$(instances "$svc")"

  echo "  requests: $total, failed: $bad"
  echo "  instances before: $before"
  echo "  instances after:  $after"
  [ "$bad" -eq 0 ] || { echo "  FAIL: $bad dropped request(s) during the $svc rollout"; fail=1; }
  # The rolled instance must actually change - a no-op rollout would trivially pass the
  # zero-drop check. Container id stands in for "served build id": we roll to a new image,
  # so a changed instance means new code is live.
  [ "$before" != "$after" ] || { echo "  FAIL: $svc instance did not change - rollout was a no-op"; fail=1; }
done

if [ "$fail" -eq 0 ]; then
  echo "PASS: every rollout served continuously and swapped the instance"
else
  echo "REHEARSAL FAILED"; exit 1
fi
