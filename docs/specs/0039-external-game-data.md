# 0039 - External game data (private repo mount)

## Problem

The full game banks (1600 Trivia questions, ~119 Liar Liar clues) live in the public branchout
repo. As content grows and needs curation/moderation, keeping the real banks in the open repo is
undesirable: the data is a product asset we want to steward privately, and shipping it in the public
image forces every content change through a public code review. We want the real data to live in a
separate private repo, mounted into the running services at deploy time, while the public repo keeps
only a tiny valid sample so the code, tests, and local runs stay honest.

A second problem this spec closes: the Trivia and Liar Liar banks each carry a completeness gate
(total-count, per-category-count, difficulty-spread / min-per-category). The developer has decided
these gates are wrong: content grows over time and spread is deliberately uneven, so a fixed
count/spread check only fights the content instead of protecting the engine. They must go; only the
per-item structural checks (the ones that keep a malformed item from crashing the engine) stay.

## Outcome

- The engine reads its game data from a mount at `GAME_DATA_DIR` when that env var is set, falling
  back to the bundled package `data/` otherwise. A single mount root serves both games because the
  relative read paths (`data/trivia/...`, `data/liar-liar/...`) are unchanged.
- The public repo ships only a small sample bank (8 Trivia items per category, 5 Liar Liar items per
  category, all 8 categories per game) - valid, loadable, and enough for local dev, unit tests, and
  a 1-round e2e.
- Boot-time validation checks per-item structure only (id format, uniqueness, required fields,
  bounded difficulty, no duplicate prompt within a category). No count or spread gate remains, so a
  bank of any size validates as long as each item is well-formed.
- Production deploy clones the private data repo, checks out the tag pinned in `deploy/data.version`,
  and bind-mounts it read-only into `game-engine` (the reader) and `admin` (future moderation).

## Scope

In:
- `packages/game-sdk/src/assets.ts` - mount-aware fs asset loader.
- `packages/games/trivia` and `packages/games/liar-liar` - remove completeness gates, shrink data to
  a sample, update tests.
- `deploy/` - `data.version`, `compose.site.yml` mount + env, `README.md` docs, `release.yml` sync.
  The `admin` service gets the same read-only mount + `GAME_DATA_DIR` as `game-engine`, but its mount
  is **intentionally inert today**: admin does not read the banks yet. It is provisioned now so the
  future content-moderation surface needs no deploy change; the trade-off is that a data-checkout
  failure also blocks admin's rollout, acceptable because the deploy fails closed regardless.

Out:
- The private `branchout-data` repo itself, its content, and its release tagging - operator-run,
  documented here only. Adding the `DATA_REPO_TOKEN` secret is a one-time operator step.
- Any change to the `AssetLoader` / `AssetLoaderFactory` interfaces or their call sites.
- Deploy secrets, SSH, GitHub tokens.

## Approach

- **Loader.** In `createFsAssetLoaderFactory().forModule`, if `process.env.GAME_DATA_DIR` is set and
  non-empty use it as the read root for every module; else keep `resolvePackageRoot(moduleUrl)`. The
  factory is created once at engine boot, but the env read stays in `forModule` so a per-call check
  is cheap and there is one clear branch to comment.
- **Validation.** Keep the exported `validateQuestionBank` / `validateClueBank` names (callers and
  boot depend on them) but drop the count/spread rules. Delete `validateSeedBank`,
  `MIN_CLUES_PER_CATEGORY`, `TOTAL_EXPECTED`, `PER_CATEGORY`, `MIN_DISTINCT_RATINGS`,
  `MIN_RATING_SPAN` and every reference. Liar Liar's boot already validates the lenient
  `validateClueBank`; Trivia's boot already validates `validateQuestionBank` - both keep working.
- **Sample data.** Slice each JSON file to its first N items programmatically (2-space indent,
  trailing newline) so structure and ids stay intact. Keep `files: ["dist","data"]` so a local /
  fallback run still bundles the sample.
- **Deploy.** `deploy/data.version` = `0.1.0` (a git tag in the private data repo). Org policy blocks
  SSH deploy keys on the box, so the box holds no GitHub credential and never fetches the data repo.
  Instead the `deploy` job in `release.yml` checks out `rogueoak/branchout-data` at that tag on the
  runner (via a read-only `DATA_REPO_TOKEN` PAT) and rsyncs its `data/` to the box over the existing
  deploy SSH key (`--delete` for an exact mirror), then writes `GAME_DATA_HOST` into `.env.prod`.
  `compose.site.yml` bind-mounts `${GAME_DATA_HOST}/data` at `/srv/game-data/data:ro` and sets
  `GAME_DATA_DIR=/srv/game-data` on `game-engine` and `admin`.

Trade-off: the read root is resolved per `forModule` call from the environment rather than captured
once. That is deliberate - it keeps the mount override a single obvious branch with no factory-level
state, and `forModule` is called a handful of times at boot, not on a hot path.

## Acceptance

- [ ] With `GAME_DATA_DIR` set, `forModule(...).readJson('data/trivia/nature.json')` reads from the
      mount; unset, it reads the bundled package data. Existing call sites unchanged.
- [ ] `validateQuestionBank` / `validateClueBank` reject a bad id, a duplicate id, a non-lowercase
      Trivia answer, an out-of-range difficulty, a missing required field, and a duplicate prompt in
      a category - and accept a small valid bank of any size. No count/spread rule remains.
- [ ] Each Trivia category file has 8 items; each Liar Liar file has 5; all 8 categories per game.
      The sample loads and validates.
- [ ] `deploy/data.version` is exactly `0.1.0\n`. `release.yml` checks out the private repo at that
      tag on the runner and rsyncs its `data/` to the box, then writes `GAME_DATA_HOST`.
      `compose.site.yml` mounts the data read-only into `game-engine` and `admin` with
      `GAME_DATA_DIR=/srv/game-data`. `deploy/README.md` documents the external repo, the
      `DATA_REPO_TOKEN` secret, the pinned tag, the GHA-to-box rsync, the mount, and the loader env.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.
