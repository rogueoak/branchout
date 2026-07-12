# Plan 0043 - Teeter Tower (insider engine game)

Build plan for spec `0043`. Depends on spec `0042` (the `move` channel). Built in the
`teeter-tower` worktree, tested before commit.

## Steps

1. **Engine package** `packages/games/teeter-tower` (`@branchout/game-teeter-tower`): headless,
   deterministic `GameModule` porting the prototype physics (shapes, levels, legality, scoring,
   pendulum, settle) onto matter-js core. One piece-drop = one round; `configure` -> 53 rounds;
   `scratch` holds seed + tower + level; `collectMove` parses `{ angle, dropX }` and rejects
   not-your-turn / illegal; `reveal` simulates once, records a keyframe track, updates tower/score.
   Determinism: Mulberry32 seeded PRNG, fixed 1/60 timestep, 300-step cap, calm-detection sampling.
   Unit tests: determinism, scoring/height, rejection, level transition.
2. **Engine wiring**: add `visibility?: 'public' | 'insider'` to `GameManifest`; register
   `teeterTowerPlugin` (visibility `insider`) in the engine boot list.
3. **Web module** `apps/web/lib/games/teeter-tower`: `protocol.ts` decoders mirroring the payloads;
   `Viewer` (canvas renderer + track playback + target line/score/eyes, mobile-first, theme tokens,
   auto-advances from `leaderboard` via `onAdvance` for continuous solo play); `Remote` (active
   player's spin-angle + slide-dropX aim -> `onMove`; watcher state otherwise); minimal
   `ConfigPanel`; `index.ts` `GameUiModule` (visibility `insider`).
4. **Gating**: `visibility` on the web `GameUiModule` + `gamesForViewer(insider)`; the picker takes
   an `insider` prop and filters; RoomClient ignores an insider deep-link for a non-insider;
   catalog/`/games`/feature pages/`sitemap.ts` exclude insider games; `InsiderHome` lists insider
   games with apex `?game=` deep links. Shell stays game-agnostic (`onAdvance` added to
   `GameViewProps`, wired from the host `advance` control in `GameStage`).
5. **Brand**: `assets/game-teeter-tower.svg` -> `packages/brand/src/teeter-tower.ts` (+ tsup entry +
   package export); UI icon reads it.
6. **Tests**: web unit (protocol, registry visibility filter, config, Viewer/Remote smoke); e2e
   extends the insider suite (insider sees + starts + drops; non-insider cannot).
7. **Reflect**: `features.md` + `architecture.md` updated.

## Verification
`pnpm turbo typecheck lint test build` + `prettier --check .` green; e2e green; manual mobile
(~360px) play on `insider.localhost`.

## Known follow-up
Server-side (control-plane) start guard for insider-visibility games (defence in depth); the current
gate is the picker filter + deep-link guard + the insider account boundary.
