# 0021 - End-to-end tests with Playwright

## Problem

The repo's first non-negotiable (CLAUDE.md) is that large, multi-surface features ship with
end-to-end tests that prove the happy path and keep it working. Today there is none: coverage is
unit tests (vitest) and app-level integration tests (Fastify `inject`, in-memory stores). Nothing
drives a real browser against the real running stack, so a regression that only shows up when the
web app, control-plane, game-engine, Postgres, and Redis are wired together - a broken share
unfurl, a room that will not start, a round that never reveals - can pass CI and reach players.

We need a real browser e2e harness, and we want **Playwright**. The monorepo is pnpm workspaces +
Turborepo (no Nx); the harness must fit that and run the same stack developers already use locally
(Colima + `docker compose`), not a bespoke mock.

## Outcome

- A Playwright harness at the repo root that runs the **full docker-compose stack** (Postgres +
  Redis + web + control-plane + game-engine) and drives it in a real browser.
- `pnpm e2e` brings the stack up (real services), runs the specs, and tears it down; a developer
  with Colima running gets a green (or a trace to open) with one command.
- Two shipping specs that establish the pattern:
  - **Share unfurl (closes spec 0020's e2e checkbox):** a `/join?code=` link serves the correct
    Open Graph card - the game's card for a room that picked a game, the generic card for a bad
    code - with `og:title` "Join my game".
  - **Trivia round happy path:** a host signs up, creates a room, a second player joins by code,
    the host starts a 1-round Trivia game, both answer, and the round reveals and lands on a
    results screen with standings.
- CI runs the e2e suite on every PR, against the same stack, and uploads the Playwright report +
  traces on failure so a red build is debuggable without reproducing locally.

## Scope

In:
- A root Playwright setup: `@playwright/test` dev dependency, `playwright.config.ts`, an `e2e/`
  test dir, and a thin `e2e` workspace package so it is not bundled into any app.
- Stack lifecycle via Playwright `globalSetup`/`globalTeardown`: `docker compose` up with
  `--wait` (healthchecks gate readiness) using the dev overlay (which points the browser at the
  published `localhost` control-plane/engine ports), then `down -v`. A dedicated compose project
  name and an env file so an e2e run does not collide with a developer's running dev stack.
- Two spec files: `e2e/share-unfurl.spec.ts`, `e2e/trivia-round.spec.ts`, plus small helpers
  (sign up an account, create a room, read the join code) shared between them.
- Test data-testids added to the web app **only where a selector would otherwise be fragile**
  (e.g. the join code / share link, the answer field, the results screen) - accessible
  role/text selectors preferred everywhere they are stable.
- A CI job that starts the stack, installs the Chromium browser (`--with-deps`), runs `pnpm e2e`,
  and always uploads `playwright-report/` + traces as an artifact.
- Docs: reflect `overview/` (features: e2e coverage; architecture: how e2e runs), and a short
  `e2e/README.md` on running it locally (Colima note, one command).

Out:
- Cross-browser matrix (Chromium only to start; Firefox/WebKit later) and mobile-device emulation
  beyond one small-viewport project (the product is mobile-first, so one 390px project is in).
- Visual-regression / screenshot-diffing.
- Rewriting existing unit/integration tests, or gating `pnpm test` on Docker - e2e is a separate
  task and CI job, never part of the fast unit run.
- Seeding data by reaching into Postgres/Redis directly; tests set up state through the real UI
  and public APIs only.

## Approach

- **Real stack, dev overlay.** Reuse `infra/docker-compose.yml` + `docker-compose.override.yml`;
  the overlay already sets `NEXT_PUBLIC_CONTROL_PLANE_URL`/`NEXT_PUBLIC_ENGINE_WS_URL` to the
  published `localhost` ports so a host browser reaches every service directly (no Caddy). Bring
  it up under a distinct project name (`branchout-e2e`) with its own `.env` so it is isolated
  from a running dev stack and can pick alternate host ports if 3000/4000/4001 are taken.
- **Readiness by healthcheck, not sleep.** `docker compose up --wait` blocks until every service
  is healthy (the compose file already defines `/health` checks). `globalSetup` then does a final
  poll of the web `/health` before returning, so no spec starts against a half-up stack.
- **State through the front door.** The trivia spec signs up a real account and drives the real
  lobby/config/answer UI; the second player joins by code in a second browser context. No DB
  seeding, so the test exercises the same paths a player does. Two contexts (host, player) model
  the multi-device reality.
- **Determinism.** Configure a 1-round game to keep the happy path short and stable; assert on
  role/text and a few added testids, never on question content (the bank is randomized). Enable
  Playwright retries in CI (not locally), `trace: 'on-first-retry'`, and video/screenshot on
  failure.
- **CI cost, eyes open.** The e2e job builds and boots the stack, so it is minutes, not seconds;
  it runs as its own job (parallel to the fast unit job) and only on PRs + main. If it ever needs
  bounding (a slow flow skipped), the run logs what it skipped - no silent narrowing of coverage.

## Acceptance

- [ ] `pnpm e2e` locally (Colima running) brings the full stack up via docker compose, runs both
      specs green, and tears the stack down; a failure leaves an openable trace.
- [ ] Share-unfurl spec: a room that selected Trivia serves `og:image` ending `share-trivia.png`
      and `og:title` "Join my game" at `/join?code=CODE`; an unknown code serves `share-join.png`.
- [ ] Trivia-round spec: host signs up, creates a room, a second player joins by code, host starts
      a 1-round game, both submit an answer, and the round reveals and reaches a results/standings
      screen - all in a real browser against the real stack.
- [ ] The suite selects by role/text or a documented testid, never by randomized question content;
      it passes on repeat runs (no order/content flakiness) and has retries + trace-on-retry in CI.
- [ ] CI runs the e2e job on PRs, boots the stack, installs Chromium, runs `pnpm e2e`, and always
      uploads the Playwright report + traces artifact.
- [ ] Only stable-selector testids were added to app code; no product behavior changed.
- [ ] `overview/` docs reflect the new e2e capability and how it runs; `e2e/README.md` documents
      the one-command local run and the Colima prerequisite.
