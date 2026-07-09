# End-to-end tests (Playwright)

Browser end-to-end tests that drive the **full stack** - web + control-plane + game-engine +
Postgres + Redis, via `docker compose` - the way a real player and a link crawler hit it. This is
the harness the repo's first non-negotiable (mobile-first, e2e for large features) requires.

## What runs

- `tests/share-unfurl.spec.ts` - Open Graph share cards (spec 0020): the home card, a Trivia
  room's "Join my game" card, and the generic fallback for a bad code. Desktop Chromium.
- `tests/trivia-round.spec.ts` - the flagship happy path: a host and a second player play a full
  one-round Trivia game across two browser contexts. Desktop Chromium.
- `tests/mobile-smoke.spec.ts` - mobile-first guard: the landing and join pages render and fit at
  a phone viewport (Pixel 7, no horizontal overflow).

## Run it locally

Prerequisite: a running Docker engine. This repo uses **Colima** locally:

```sh
colima start            # if it is not already running
pnpm e2e                # from the repo root
```

`pnpm e2e` (Playwright `globalSetup`):

1. builds the workspace (`pnpm build`) so the dev containers serve the built theme CSS, the
   generated brand share cards, and every package's `dist` (bind-mounted),
2. brings the stack up with `docker compose ... up --build --wait` under a dedicated
   `branchout-e2e` project on shifted host ports (web `3100`, control-plane `4100`, engine `4101`)
   so it does **not** collide with a running dev stack,
3. waits for the web app's `/health`, then runs the specs and tears the stack down.

Useful env vars:

- `E2E_SKIP_BUILD=1` - skip the workspace build on a fast re-run (tree already built).
- `E2E_KEEP_STACK=1` - leave the stack up after the run (inspect logs, re-run a single spec).
- `E2E_SKIP_STACK=1` - assume a stack left up by a prior `E2E_KEEP_STACK` run and only wait for
  health; skips the build and `docker compose up` for the fastest spec-iteration loop.
- `DOCKER_BIN=/path/to/docker` - use a non-standard docker CLI (e.g. a Colima install where the
  binary is not symlinked onto `PATH`).

Reports: `pnpm --filter @branchout/e2e e2e:report` opens the last HTML report; failures keep a
trace, screenshot, and video under `e2e/test-results/`.

## Notes

- `pnpm test` (the fast unit/integration run) does **not** run e2e - this package exposes an
  `e2e` script, not `test`, so Docker is never required for the normal test loop. CI runs e2e as
  its own job.
- The functional specs run on desktop Chromium, where a host and a joiner both default to the
  interactive (viewer) mode a game needs. Full gameplay at a phone viewport (where the host
  defaults to remote-only) is a follow-up; the mobile lane covers responsiveness today.
