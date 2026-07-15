#!/usr/bin/env bash
#
# ctct-keepalive.sh - keep the Constant Contact refresh token alive (spec 0049).
#
# The newsletter subscribe endpoint (spec 0047) mints a CTCT access token lazily from a long-lived
# refresh token in the host `.env.prod`. A CTCT device-flow refresh token can rotate and expire when
# left idle, and the subscribe route only exercises it on a real subscribe - so on a quiet site the
# token can die with no warning. This wrapper exercises it out-of-band, daily, from cron.
#
# It runs the `ctct` CLI's `refresh-token` as a container (the box has no Node runtime), which reads
# CTCT_CLIENT_ID + CTCT_REFRESH_TOKEN from the env-file and prints JSON to stdout. On success it logs
# `OK token refreshed` (never the token). If CTCT rotated the token (`rotated: true`), it backs up the
# env-file and atomically rewrites the CTCT_REFRESH_TOKEN= line, then logs LOUDLY that the
# control-plane container must be recreated to load it (it does NOT auto-recreate: a rotation is rare
# for a long-lived token and a force-recreate would cause an unexpected blip). On failure it emails a
# Resend alert (if RESEND_API_KEY is set in the env-file) and exits non-zero so cron.err captures it.
#
# Secrets are read from the env-file at runtime and kept out of the log (status/error only).
#
# Install (once, on the host, as the deploy user):
#   docker pull ghcr.io/mattmaynes/ctct-cli:latest
#   install -m 0755 deploy/ctct-refresh/ctct-keepalive.sh /home/deploy/ctct-refresh/ctct-keepalive.sh
#
# Crontab (deploy user; daily, UTC; offset from the rogueoak keepalive):
#   27 8 * * * /home/deploy/ctct-refresh/ctct-keepalive.sh /home/deploy/branchout/deploy/docker/.env.prod branchout.games >> /home/deploy/ctct-refresh/cron.err 2>&1
#
# Dependencies: docker, python3 (both present on the box). See deploy/README.md.

set -euo pipefail

ENV_FILE="${1:-/home/deploy/branchout/deploy/docker/.env.prod}"
LABEL="${2:-branchout.games}"

IMAGE="ghcr.io/mattmaynes/ctct-cli:latest"
LOG_DIR="$HOME/ctct-refresh"
LOG_FILE="$LOG_DIR/keepalive.log"

mkdir -p "$LOG_DIR"

# Timestamped line to the log. Never pass a token in here.
log() {
  printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$LABEL" "$1" >>"$LOG_FILE"
}

# Read one KEY=value from the env-file (first match), stripping the KEY= prefix. Never logged.
read_env() {
  # shellcheck disable=SC2016
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

# Send a Resend alert. Best-effort: if RESEND_API_KEY is unset we only log (never fail the cron on
# a missing alert channel). The API key and message never touch the log.
alert() {
  local reason="$1"
  local api_key to_addr from_addr
  api_key="$(read_env RESEND_API_KEY)"
  to_addr="${CTCT_ALERT_TO:-$(read_env CTCT_ALERT_TO)}"
  from_addr="${CTCT_ALERT_FROM:-$(read_env CTCT_ALERT_FROM)}"
  to_addr="${to_addr:-feedback@rogueoak.com}"
  from_addr="${from_addr:-branchout@rogueoak.com}"

  if [ -z "$api_key" ]; then
    log "no RESEND_API_KEY in env-file; skipping alert email"
    return 0
  fi

  local subject body payload
  subject="CTCT keepalive FAILED for $LABEL"
  body="The Constant Contact token keepalive for $LABEL failed: $reason. Check ~/ctct-refresh/keepalive.log and re-mint the token (device flow) if needed - see deploy/README.md."

  # Build the JSON with python3 so any quotes/newlines in the reason are escaped safely.
  payload="$(TO="$to_addr" FROM="$from_addr" SUBJECT="$subject" BODY="$body" python3 -c '
import json, os
print(json.dumps({
    "from": os.environ["FROM"],
    "to": [os.environ["TO"]],
    "subject": os.environ["SUBJECT"],
    "text": os.environ["BODY"],
}))')"

  # -H Authorization carries the key; do not echo it. Failure to alert is logged, never fatal.
  if curl -fsS --max-time 20 -X POST 'https://api.resend.com/emails' \
      -H "Authorization: Bearer $api_key" \
      -H 'Content-Type: application/json' \
      -d "$payload" >/dev/null 2>&1; then
    log "alert email sent to $to_addr"
  else
    log "WARNING: failed to send alert email to $to_addr"
  fi
}

# Fail hard: log, alert, exit non-zero (so cron.err records it).
fail() {
  local reason="$1"
  log "FAIL $reason"
  alert "$reason"
  exit 1
}

# --- Run the refresh -------------------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  fail "env-file not found at $ENV_FILE"
fi

# Capture stdout; on a non-zero exit, `run_out` holds whatever was printed. `set -e` must not abort
# here - we want to inspect the failure - so guard the assignment. Capture stderr to a temp so a hard
# failure's real cause (e.g. invalid_grant) reaches the log/alert; the CLI prints the OAuth error to
# stderr and never echoes the token there, so a bounded snippet is safe to surface.
run_rc=0
run_err="$(mktemp)"
run_out="$(docker run --rm --env-file "$ENV_FILE" "$IMAGE" refresh-token 2>"$run_err")" || run_rc=$?
run_err_txt="$(tail -c 500 "$run_err" 2>/dev/null | tr -d '\r')"
rm -f "$run_err"

if [ "$run_rc" -ne 0 ]; then
  fail "ctct refresh-token exited $run_rc: ${run_err_txt:-no stderr}"
fi

# Parse the JSON with python3. Emit two lines: the `rotated` flag and the new refresh_token. If the
# output is not valid JSON, or carries an `error` field, or lacks refresh data, exit 3 -> we fail.
parsed="$(printf '%s' "$run_out" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(3)
if not isinstance(d, dict) or d.get("error"):
    sys.exit(3)
rt = d.get("refresh_token")
if not rt:
    sys.exit(3)
print("true" if d.get("rotated") else "false")
print(rt)
' 2>/dev/null)" || fail "could not parse refresh-token output (bad JSON or error field)"

rotated="$(printf '%s\n' "$parsed" | sed -n '1p')"
new_token="$(printf '%s\n' "$parsed" | sed -n '2p')"

log "OK token refreshed"

if [ "$rotated" = "true" ]; then
  # The token rotated: persist it so the next mint uses the live token. Back up the env-file first,
  # then rewrite the CTCT_REFRESH_TOKEN= line atomically (temp file in the same dir + mv, so a crash
  # never leaves a half-written env-file). Do NOT print the token anywhere.
  backup="$ENV_FILE.bak.$(date -u +'%Y%m%dT%H%M%SZ')"
  cp -p "$ENV_FILE" "$backup"
  # Each backup holds a live-at-the-time token; bound their growth by keeping only the 5 most recent
  # (perms stay 0600 via cp -p). A rotation is rare, so this is plenty of recovery history.
  # shellcheck disable=SC2012 # names are our own ISO-timestamp backups (no spaces/newlines), ls is safe
  ls -1t "$ENV_FILE".bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f

  tmp="$(mktemp "$(dirname "$ENV_FILE")/.env.prod.XXXXXX")"
  # Match the mode of the original so the rewritten file stays 0600.
  chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"

  if grep -qE '^CTCT_REFRESH_TOKEN=' "$ENV_FILE"; then
    # Replace the existing line. Use awk so the token value is never expanded by the shell.
    NEW_TOKEN="$new_token" awk '
      /^CTCT_REFRESH_TOKEN=/ { print "CTCT_REFRESH_TOKEN=" ENVIRON["NEW_TOKEN"]; next }
      { print }
    ' "$ENV_FILE" >"$tmp"
  else
    # No existing line (unexpected, but be safe): append it.
    cp "$ENV_FILE" "$tmp"
    printf 'CTCT_REFRESH_TOKEN=%s\n' "$new_token" >>"$tmp"
  fi

  mv "$tmp" "$ENV_FILE"

  log "ROTATED refresh token persisted to $ENV_FILE (backup: $backup)"
  log "ACTION REQUIRED: recreate control-plane to load the rotated token: cd ~/branchout && docker compose -f deploy/docker/compose.site.yml up -d --force-recreate control-plane"
fi

exit 0
