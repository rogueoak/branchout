# 0049 - Keep the Constant Contact refresh token alive (cron keepalive + alert)

## Problem

The newsletter subscribe endpoint (`POST /v1/subscribe`, spec 0047) mints a Constant Contact
(CTCT) access token from a long-lived refresh token stored in the host-only `.env.prod`. The route
mints **lazily** - only on a real subscribe - then caches the access token, so on a low-traffic site
the refresh token can sit unused for a long time. A CTCT device-flow refresh token can **rotate and
expire when it is left idle**; nothing exercises it in the meantime (deploys do not: the mint is
lazy), so the first person to subscribe after it dies hits a 500 with no earlier signal.

The sibling rogueoak site hit exactly this failure mode on its own subscribe token (its spec 0009).
Branchout runs the same CTCT flow against its own long-lived token, so it carries the same latent
failure - un-triggered only until the token has been idle long enough to expire.

For: the site owner (subscribe stays up without manual token babysitting) and every visitor who
tries to join the mailing list.

## Outcome

Observable when done:

1. A **daily host cron** exercises the refresh token out-of-band (independent of visitor traffic),
   so the idle clock never runs out.
2. On any refresh failure, the owner gets an **email alert via Resend** naming the label and the
   error - hours to days before a visitor could hit a 500 (the cached access token is still valid
   for a window after the refresh token dies).
3. The keepalive is **side-effect-free on success** for a stable token: the same value comes back
   and `.env.prod` is untouched. If CTCT returns a **different** refresh token (a rotation), it is
   persisted atomically (temp file + `mv`, with a backup of the old env-file), and the log flags
   **loudly** that the `control-plane` container must be recreated to load it. The keepalive does
   **not** auto-recreate: a rotation is rare for a long-lived token and a force-recreate would cause
   an unexpected blip.
4. A deploy never clobbers a rotated token. `release.yml` rewrites `.env.prod` from GitHub secrets
   every deploy; `CTCT_REFRESH_TOKEN` is made **preserved-across-deploys** (read the box's existing
   value, fall back to the secret only as an initial seed), exactly like `ADMIN_ROOT_EMAIL` /
   `ADMIN_ROOT_PASSWORD` already are.
5. Secrets are never hard-coded (this repo is public): the wrapper reads them from `.env.prod` at
   runtime and keeps the token out of its log (status/error only).

## Scope

**In:**

- `deploy/ctct-refresh/ctct-keepalive.sh` - a host wrapper that runs the `ctct` CLI's
  `refresh-token` as a container, logs OK, persists a rotated token atomically, and alerts via
  Resend on failure.
- `deploy/README.md` - a "CTCT token keepalive" section: pull the image, install the wrapper, the
  crontab entry, bootstrapping the initial token via device flow, the three GitHub secrets, a
  manual health check, and the double-opt-in go-live note.
- `.github/workflows/release.yml` - preserve `CTCT_REFRESH_TOKEN` across deploys (initial seed from
  the secret; thereafter the box's rotated value wins). `CTCT_CLIENT_ID` / `CTCT_LIST_ID` stay
  sourced from secrets each deploy (they are stable).
- Reflect: `docs/overview/architecture.md` (Deployment) + a `learnings.md` entry.

**Out:**

- No app code change. The subscribe endpoint (spec 0047) is untouched.
- No auto-recreate of `control-plane` on rotation (flagged in the log for an operator).
- No change to how `CTCT_CLIENT_ID` / `CTCT_LIST_ID` are sourced (stable, from secrets).

## Approach

The refresh logic lives in the versioned, unit-tested **`ctct` CLI** (`ctct refresh-token`,
shipped as `ghcr.io/mattmaynes/ctct-cli:latest`), run as a container on the box (which has no Node
runtime) - one tested implementation shared with the cohosted rogueoak site, not a hand-rolled
`curl`. Given `CTCT_CLIENT_ID` + `CTCT_REFRESH_TOKEN` in the env-file it calls the CTCT token
endpoint with `grant_type=refresh_token` and prints JSON
(`{ access_token, expires_at, refresh_token, rotated, ... }`). It is **stateless when the token
comes from env** and never writes back to a file - so the wrapper owns persistence.

- **Host wrapper** `deploy/ctct-refresh/ctct-keepalive.sh <env-file> <label>`
  (defaults `/home/deploy/branchout/deploy/docker/.env.prod` and `branchout.games`):
  `docker run --rm --env-file <env-file> ghcr.io/mattmaynes/ctct-cli:latest refresh-token`, capture
  stdout, parse with `python3`. On success log `OK token refreshed` to `~/ctct-refresh/keepalive.log`
  (never the token); if `rotated` is true, back up the env-file, rewrite the `CTCT_REFRESH_TOKEN=`
  line atomically (temp file + `mv`), and log LOUDLY that `control-plane` must be recreated. On
  failure (non-zero exit, JSON parse error, or an `error` field) send a Resend alert
  (`POST https://api.resend.com/emails`) and log the failure; exit non-zero so `cron.err` captures
  it. `RESEND_API_KEY` is read from the env-file; if unset, log only (do not fail the cron).
  Alert to/from default to `feedback@rogueoak.com` / `branchout@rogueoak.com`, overridable via
  optional `CTCT_ALERT_TO` / `CTCT_ALERT_FROM`. Safe under `set -euo pipefail`.
- **Crontab** (deploy user): one daily run at a fixed UTC time, offset from the rogueoak keepalive
  so the two do not fire in the same minute, redirecting stderr to `~/ctct-refresh/cron.err`.
- **Preserve across deploys.** `release.yml` reads `PREV_CTCT_REFRESH_TOKEN` from the existing
  `.env.prod` before it is truncated and writes the preserved value if present, else the
  `secrets.CTCT_REFRESH_TOKEN` seed - only when the resolved value is non-empty (keeping the
  existing inert-when-empty behaviour). A comment explains why (the keepalive rotates it on the box;
  a deploy must not clobber it).

The wrapper lives in `deploy/ctct-refresh/` in the repo (documentation + source of truth) but is
**installed once** to `/home/deploy/ctct-refresh/` on the host, outside the git checkout, so a
deploy `git reset --hard` never disturbs it or its logs.

## Acceptance

- [ ] `deploy/ctct-refresh/ctct-keepalive.sh` exists, is executable, and passes a hand review for
      `set -euo pipefail` quoting pitfalls (shellcheck if available).
- [ ] The wrapper never echoes the refresh/access token to stdout, stderr, or the log.
- [ ] On a rotated token it backs up the env-file and rewrites the `CTCT_REFRESH_TOKEN=` line
      atomically, then logs that `control-plane` must be recreated (no auto-recreate).
- [ ] On failure it alerts via Resend (when `RESEND_API_KEY` is set) and exits non-zero; with no key
      it logs only and does not fail the cron.
- [ ] `release.yml` preserves `CTCT_REFRESH_TOKEN` across deploys (box value wins, secret is the
      seed) and still writes the line only when the resolved value is non-empty. `CTCT_CLIENT_ID` /
      `CTCT_LIST_ID` are unchanged.
- [ ] `deploy/README.md` documents the image pull, wrapper install, crontab entry, device-flow
      bootstrap, the three secrets, a manual health check, and the double-opt-in go-live note.
- [ ] `docs/overview/architecture.md` documents the keepalive cron and the preserved token; a
      `learnings.md` entry captures the "preserve a box-rotated secret across a from-secrets env
      rewrite" rule.
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` all pass.
