# 0019 - Trivia as an independent game package

## Problem

Spec `0018` built the plugin runtime (`@branchout/game-sdk`) and made Trivia register through a
`GamePlugin`, but Trivia's code and its 1600-question data still live *inside* the engine
(`apps/game-engine/src/games/trivia/`, `apps/game-engine/data/trivia/`), and its bank still
self-locates its data by walking the filesystem up to the engine app root. That is the last thing
keeping Trivia from being a truly independent, pluggable game and the pattern the next game (Liar
Liar) will follow.

## Outcome

- Trivia is its own workspace package `@branchout/game-trivia` (`packages/games/trivia`), depending
  on `@branchout/game-sdk` and `@branchout/protocol`, with its own build/test/lint tooling.
- It loads its question bank through the injected `AssetLoader`
  (`services.assets.forModule(import.meta.url)`), rooted at its own package - no self-locating
  filesystem walk.
- The engine registers `triviaPlugin` from `@branchout/game-trivia` and contains no `src/games/`
  or `data/` directory. Nothing else changes: game id stays `trivia`, wire protocol / `SessionState`
  / Redis keys are untouched.

## Scope

In:
- New `packages/games/trivia` (`@branchout/game-trivia`): `git mv` the 6 modules + their 5 tests and
  `index.ts` into `src/`, and the 8 category JSON files into `data/trivia/`. Package tooling mirrors
  `@branchout/game-sdk` (tsup single `.` entry, `dts`, `external` protocol + game-sdk; tsconfig
  extends the repo base three levels up; `files: ["dist","data"]` so the data ships).
- `loadQuestionBank(assets: AssetLoader)`: read each category via `assets.readJson`; delete
  `resolveTriviaDataDir()` and the `node:fs`/`node:url`/`node:path` imports. `triviaPlugin.create`
  passes `services.assets.forModule(import.meta.url)`.
- The real-data `question-bank.test.ts` uses a real `createFsAssetLoaderFactory().forModule(...)`
  loader - proving the loader resolves the package's own `data/trivia` from the package root.
- Engine: add the `@branchout/game-trivia` dependency; `index.ts` imports `triviaPlugin` from it;
  remove the emptied `src/games/` and `data/` directories.

Out:
- Any lifecycle change (timed collecting, submission rejection, the decision loop) - `0020`.
- Any new game or content.

## Approach

- **`git mv`, not rewrite** - the Trivia logic is unchanged; only the data-loading seam and the
  package boundary move. Keeping it a pure move keeps the diff reviewable and behavior identical.
- **Package-rooted asset loader** - the fs loader factory (`0018`) walks up from the calling
  module to the nearest `package.json`; because `trivia.ts`'s `import.meta.url` now lives in
  `packages/games/trivia`, the root is that package and `data/trivia/*.json` resolves whether the
  code runs from `src` (tsx) or bundled `dist`. tsup keeps the package `external` in the engine
  bundle, so the data is read from disk (`node_modules/@branchout/game-trivia/data`), never inlined.

## Acceptance

- [ ] `@branchout/game-trivia` builds and tests independently; all Trivia unit tests
      (matching/difficulty/selection/trivia/question-bank) run inside the package.
- [ ] The real-data question-bank test loads 1600 questions via the injected fs loader and passes
      the full validator.
- [ ] `apps/game-engine` has no `src/games/` and no `data/` directory; it registers `triviaPlugin`
      from `@branchout/game-trivia`; a Trivia game still starts, plays, and reports unchanged.
- [ ] The engine's built `dist/index.js` does not inline the question JSON (Trivia stays external).
- [ ] `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` green.
