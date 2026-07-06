# 0011 - Deploy pipeline review findings

## Symptom

The persona review of the `0011` deploy pipeline (PR #14: Caddy edge proxy + app stack + the
`release.yml` deploy job) surfaced one blocker and a cluster of hardening findings around Compose
path resolution, SSH secret handling, and defense-in-depth network scoping. All were addressed
before merge; captured here so future compose/deploy work does not repeat them.

## Findings and fixes

1. **BLOCKER - `env_file` resolves relative to the compose file's directory, not the run cwd.**
   `compose.site.yml` declared `env_file: .env.prod` and the deploy wrote `.env.prod` to the repo
   root (`$REPO`), while Compose looks for it next to the compose file (`deploy/docker/.env.prod`).
   The mismatch would have booted Postgres and every service with an empty `POSTGRES_PASSWORD` and
   `SESSION_SECRET`. Fix: write the env file to `deploy/docker/.env.prod` (alongside the compose
   file) and gitignore/dockerignore it. Same trap applies to relative build contexts and bind
   mounts - all resolve relative to the compose file (or `--project-directory`), never the cwd.

2. **MAJOR (defense in depth) - the web tier had a direct route to the data tier.** `web` was
   joined to both `edge` and the internal `db` network "for SSR calls to control-plane". But
   control-plane is on `edge`, so `db` membership only granted a compromised web container direct
   TCP to Postgres and Redis, bypassing the API boundary. Both security and architect flagged it.
   Fix: `web` is on `edge` only; it reaches control-plane there and never touches the data tier.

3. **MINOR - secrets passed on the SSH command line could leak and were quote-fragile.** Secrets
   were interpolated as `VAR='$SECRET'` into the remote SSH command argument, so they landed in the
   remote command that sshd logs at `VERBOSE`/`DEBUG`, and a single quote in a value would break the
   remote script. Fix: build shell-safe `export` lines with `printf %q` and stream them plus the
   script body over the encrypted stdin channel (`... | ssh ... bash -s`), keeping secrets off argv
   entirely and safe for any value.

4. **MINOR - GHCR logout was skippable on failure.** `docker logout ghcr.io` sat at the end of the
   `set -euo pipefail` script, so any earlier failure left run-scoped credentials in
   `~/.docker/config.json`. Fix: `trap 'docker logout ghcr.io ...' EXIT` right after login.

5. **MINOR/NIT - Caddy healthcheck was too shallow, web startup ordering was unspecified.**
   `caddy version` passes even if the server never bound its listener; switched to the admin API
   (`wget --spider http://localhost:2019/config/`). Added `web depends_on control-plane`
   (`service_healthy`) so `up -d --wait` cannot report web ready before its SSR dependency.

## Lesson

Compose relative paths anchor to the compose file, not the invoking shell; and the cheapest network
segmentation win is to keep a tier off any network it has no need to reach. Both are one-way doors
that are trivial to get right up front and awkward to notice once the stack is "working".
