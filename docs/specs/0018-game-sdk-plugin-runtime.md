# 0018 - Game SDK and plugin runtime

## Problem

The engine already has a modular seam (`GameModule`, `GameRegistry`, Trivia isolated in
`src/games/trivia/`), but it is informal: game-facing types live inside the engine, games are
hand-wired closures (`createTriviaGame(bank)`), and boot is coupled to one game's specifics (the
Trivia bank loads in `index.ts` before the engine exists). To grow "a collection of independent
games that plug in," the harness<->game boundary needs to be its own package with a
dependency-injection contract, so a game is a self-contained plugin the engine instantiates through
a well-defined interface.

This is the first spec of the pluggable-games group; `0019` (extract Trivia into a package) and
later game specs build on it. No player-visible behavior changes.

## Outcome

- A new `@branchout/game-sdk` package owns the game-facing contract: the round `GameModule`
  lifecycle types (moved out of the engine), a `GamePlugin` (manifest + `create(services)` DI
  factory + optional `dispose`), a `GameServices` bag (rng, logger, asset loader), an `AssetLoader`
  seam, and test helpers (`ManualScheduler`, seeded rng, in-memory services/assets, the stub game).
- The engine consumes plugins: a composition root builds `GameServices`, `registerPlugins` awaits
  each `plugin.create(services)` into the registry and collects each manifest's config schema, and
  `/sessions` validates the handoff config against that schema before configuring the game.
- Trivia is registered through the plugin path (an interim adapter still importing
  `src/games/trivia`); the stub game moves to the SDK as a test fixture and is dropped from prod
  boot. Wire protocol, `SessionState`, and Redis keys are unchanged.

## Scope

In:
- `packages/game-sdk` - `lifecycle.ts` (moved verbatim from the engine, incl. optional
  `allAnswered`), `plugin.ts` (`GamePlugin`, `GameManifest`, `GameServices`, `ConfigSchema`,
  `GameCapabilities`, `AssetLoader`, `AssetLoaderFactory`), `assets.ts`
  (`createFsAssetLoaderFactory`, `createMemoryAssetLoaderFactory`), `testing.ts` (`ManualScheduler`,
  `mulberry32`, `createTestServices`, `stubGame`/`stubPlugin`), package tooling mirroring
  `packages/protocol`, with a `.` and a `./testing` export.
- Engine: `lifecycle.ts` re-exports from the SDK (no import churn for internal callers);
  `services.ts` (`createGameServices`); `plugins.ts` (`registerPlugins` -> `{ registry,
  configSchemas }`); `engine.ts` `start()` validates config via the schema map before
  `module.configure`; `index.ts` boots `registerPlugins([triviaPlugin], services)`; `scheduler.ts`
  drops `ManualScheduler` (kept structurally compatible in the SDK). Add `packages/games/*` to
  `pnpm-workspace.yaml`.
- Tests: SDK tests for the asset loaders, the config-schema boundary, and `registerPlugins`; the
  stub test moves to the SDK; engine tests import `stubGame`/`ManualScheduler` from
  `@branchout/game-sdk/testing`.

Out:
- Moving Trivia's source/data into a package and switching it to the injected loader - that is
  `0019`. Any lifecycle change (timed collecting, submission rejection, the decision loop) - `0020`.
  Any new game or content - later specs.

## Approach

- **AssetLoader as a per-package factory.** A game package must read *its own* data, and tests must
  inject fake data. `GameServices.assets` is an `AssetLoaderFactory` with `forModule(import.meta.url)`
  returning a loader rooted at the calling package (prod walks up to the nearest `package.json`; a
  memory factory ignores the URL and serves an in-memory map). This keeps the harness free of any
  game-specific path knowledge and makes `create()` unit-testable.
- **ManualScheduler stays structural.** It moves to the SDK's `./testing` entry defined against its
  own tiny interface; the engine's `Scheduler` seam accepts it structurally, so prod code never
  imports test-only helpers and the SDK does not depend on the engine.
- **Config validation at the boundary, without changing downstream.** `registerPlugins` collects
  `manifest.configSchema` into a `Map<id, ConfigSchema>`; `start()` runs the schema (throws ->
  existing 400) before calling `module.configure(req.config, ...)` unchanged. For Trivia the schema
  *is* the existing `validateConfig`, so behavior is identical.
- **Stub as a fixture, not a product.** The stub only ever drove the generic lifecycle in tests;
  it moves to `@branchout/game-sdk/testing` and leaves prod boot (verified nothing starts a `stub`
  session in prod). Engine production code imports only `@branchout/game-sdk`, never `/testing`.

## Acceptance

- [ ] `@branchout/game-sdk` builds (`.` + `./testing` entries, `dts`) and is a dependency of the
      engine; the engine's prod bundle never pulls in `/testing`.
- [ ] Engine boots via `registerPlugins`; a control-plane handoff for `trivia` still starts, plays,
      and reports exactly as before (existing engine tests green, unchanged behavior).
- [ ] `/sessions` rejects an invalid game config with a 400 via the manifest schema.
- [ ] The asset-loader factory serves a package-rooted fs loader in prod and a memory loader in
      tests; `registerPlugins` rejects duplicate ids and collects schemas. Unit tests cover both.
- [ ] `pnpm build && pnpm test && pnpm typecheck && pnpm lint` are green across the workspace.
</content>
