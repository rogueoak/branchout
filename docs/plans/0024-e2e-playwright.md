# Plan 0024 - End-to-end tests with Playwright

Source: `docs/specs/0024-e2e-playwright.md`.

Core move: a root `e2e/` Playwright workspace that boots the real docker-compose stack (dev
overlay, so the browser reaches services on published `localhost` ports) via `globalSetup`, drives
it in a real browser, and tears it down. Ships the spec-0020 share-unfurl check and a full Trivia
round happy path, plus a mobile-first render guard, and runs as its own CI job.

Built stacked on the OG branch (needs spec 0020's share cards + preview endpoint); PR retargets to
`main` once #32 merges.

## Step 1 - Precondition fix on the OG branch (done in #32)

- SSR bug found while designing e2e: `join/page.tsx` `generateMetadata` used the browser client
  (`NEXT_PUBLIC_CONTROL_PLANE_URL`), which is `/api` (no server base) in prod and a `localhost`
  port resolving to the web container in Docker - so the per-game card never rendered in a real
  deployment. Fixed by a server-only `lib/room-preview.ts` using `CONTROL_PLANE_URL` (the split
  `lib/session.ts` already uses), and `CONTROL_PLANE_URL` added to the web service in the dev
  compose overlay. This is what the e2e now proves.

## Step 2 - Playwright workspace (`e2e/`)

- `e2e/package.json` (`@branchout/e2e`, private, `@playwright/test`), added to
  `pnpm-workspace.yaml`; root `e2e` script (`pnpm --filter @branchout/e2e e2e`). Deliberately not a
  `test` script, so `pnpm test`/`turbo run test` stays Docker-free.
- `e2e/tsconfig.json` extends the root base; `lint`/`typecheck` scripts so the package joins the
  existing turbo lint/typecheck.
- `playwright.config.ts`: `globalSetup`/`globalTeardown`, `workers: 1` (shared stack), retries +
  `trace: 'on-first-retry'` in CI, HTML report. Two projects: `chromium` (functional specs) and
  `mobile-chrome` / Pixel 7 (mobile smoke).

## Step 3 - Stack lifecycle (`e2e/lib/stack.ts`, `global-setup.ts`, `global-teardown.ts`)

- `stack.ts`: dedicated `branchout-e2e` compose project on shifted host ports (3100/4100/4101) so a
  run coexists with a dev stack; `up --build --wait`, `down -v`, and a `/health` poll. `DOCKER_BIN`
  override for non-standard docker installs.
- `infra/docker-compose.e2e.yml`: `ports: !reset []` for postgres/redis (reached by service name;
  no host publish) so the run does not clash on 5432/6379.
- `global-setup`: `pnpm build` (dev overlay bind-mounts host artifacts - theme CSS, brand share
  PNGs, package dist), then `up --wait`, then `/health`. `global-teardown`: `down -v`
  (`E2E_KEEP_STACK=1` to keep).

## Step 4 - Specs (`e2e/tests/`) + minimal testids

- `share-unfurl.spec.ts`: home card = `og.png`; unknown code = `share-join.png` + title
  "Join my game"; a started Trivia room = `share-trivia.png`, read from a fresh (crawler) context.
- `trivia-round.spec.ts`: host signs up, creates a room, player joins by code, host starts a
  1-round game, both answer, round reveals, final standings appear - two browser contexts.
- `mobile-smoke.spec.ts`: landing + join render and fit at ~390px (no horizontal overflow).
- Add three stable testids only where selectors are fragile: `question-prompt`, `reveal-answer`,
  `final-results`. Helpers: `signUpHost`, `createRoom`, `joinRoom`, `metaContent`.

## Step 5 - CI (`.github/workflows/ci.yml`)

- New `e2e` job (parallel to `build`): install deps, `playwright install --with-deps chromium`,
  `pnpm e2e`, always upload `playwright-report/` + `test-results/` artifact.

## Step 6 - Verify + reflect + PR

- Validate locally against Colima (`pnpm e2e` green), iterating the gameplay timing until stable.
- Reflect `overview/` (features: e2e coverage; architecture: how e2e runs; learnings: the SSR
  URL split and any harness lessons); `e2e/README.md` for the one-command local run.
- Open PR stacked on #32; retarget to `main` after #32 merges.

## Risks / watch-outs

- **Gameplay timing.** Round lifecycle is engine-timed (auto-close, dispute window, auto-advance);
  the test drives host `Next` and polls for the terminal state via `toPass` rather than fixed
  sleeps.
- **Mobile mode default.** On a phone UA the host defaults to remote-only (not a viewer), so full
  gameplay runs on desktop Chromium; the phone lane covers responsiveness. Full mobile gameplay is
  a follow-up.
- **First-run cost.** Building three images + booting is minutes; it is a separate CI job and uses
  `--wait` (healthchecks) so it never races a half-up stack.
- **Stacking.** Until #32 merges this PR is based on the OG branch; retarget to `main` on merge.
