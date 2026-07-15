# Plan 0032 - Teeter Tower playtest round 7

Source: `docs/feedback/0032-teeter-playtest-round-7.md`. Six changes across the game package
(`packages/games/teeter-tower`) and its web surface (`apps/web/lib/games/teeter-tower`). Keep the
wire contract in `types.ts` and `protocol.ts` in lockstep.

World coords: `y` grows downward; the tower grows up (toward smaller `y`).

## Step 1 - Floor friction (levels.ts, physics.ts)

- `levels.ts`: add `export const FLOOR_FRICTION_STATIC = 80;` near the grip constants, with a
  comment: Matter combines a pair as `friction = min` (kinetic), `frictionStatic = max` (static);
  a floor-only static bump grips the floor contact via `max` without touching piece-on-piece
  (which stays `PIECE_FRICTION_STATIC = 30`). Kinetic floor friction stays `PIECE_FRICTION`
  (min-combined, so raising it would be inert).
- `physics.ts`:
  - `makePlatform`: set `platform.frictionStatic = FLOOR_FRICTION_STATIC` (keep
    `platform.friction = PIECE_FRICTION`). Import the new constant.
  - `makeWalls`: set each wall's `frictionStatic = FLOOR_FRICTION_STATIC` (keep
    `wall.friction = PIECE_FRICTION`).
- Do NOT change `PIECE_FRICTION`, `PIECE_FRICTION_STATIC`, `PIECE_FRICTION_AIR`, or piece-part
  friction - piece-on-piece grip is unchanged.

## Step 2 - New pieces + rebalanced bag (physics.ts)

- Extend `PieceType` with `'notchSide' | 'notchBottom'`.
- New `TYPE_BAG` (12): `block, block, block, plank, plank, plank, notchSide, notchBottom, trap,
  ell, blob, tri`. Update the comment.
- In `makePiece`, add two branches (before the `else`/`ell`), both a single concave polygon via
  `Bodies.fromVertices(0, 0, [verts], opts)`, palette-skinned, sized near a block:
  - `notchSide`: rectangle `w=rng.range(70,96)*s`, `h=rng.range(58,78)*s`, with a rectangular
    notch cut into the RIGHT edge (notch height `nh = h*rng.range(0.3,0.42)`, depth
    `nd = w*rng.range(0.3,0.4)`), one concave vertex on the right edge, flat bottom. Vertex order
    (local, y-down), counter-clockwise like `trap`:
    top-left `{-w/2,-h/2}`, top-right `{w/2,-h/2}`, notch-top `{w/2,-nh/2}`,
    notch-inner `{w/2-nd,0}`, notch-bottom `{w/2,nh/2}`, bottom-right `{w/2,h/2}`,
    bottom-left `{-w/2,h/2}`.
  - `notchBottom`: rectangle `w`, `h` (same ranges), with a V-notch cut UP into the bottom edge
    (notch width `nw = w*rng.range(0.3,0.44)`, depth `nd = h*rng.range(0.3,0.42)`), one concave
    apex. Vertex order: bottom-left `{-w/2,h/2}`, notch-left `{-nw/2,h/2}`,
    notch-apex `{0, h/2-nd}`, notch-right `{nw/2,h/2}`, bottom-right `{w/2,h/2}`,
    top-right `{w/2,-h/2}`, top-left `{-w/2,-h/2}`.
- Leave `blob`/`tri`/`ell`/`trap` geometry unchanged. Keep the `Body.setPosition(body,{x:0,y:0})`
  recentre and the eyes/spinSeed tail as-is (applies to all branches).
- Sanity: both new pieces are concave, so `body.parts.length > 1` after decomposition and they
  store/rebuild through the existing `blob` path (`localVerts` -> multiple loops ->
  `bodyFromStored` compound branch). Confirm with a round-trip test (Step 6).

## Step 3 - Round-transition phase machine (types.ts, protocol.ts, physics.ts, teeter-tower.ts)

### 3a. Wire type

- `packages/games/teeter-tower/src/types.ts`: add
  `export type TeeterPhase = 'playing' | 'complete' | 'intro';` and a `phase: TeeterPhase` field
  on `TeeterSim` (document it).
- `apps/web/lib/games/teeter-tower/protocol.ts`: mirror `TeeterPhase` + `phase` on `TeeterSim`.
  In `asTeeterSim`, decode `phase`: accept `'playing' | 'complete' | 'intro'`, DEFAULT to
  `'playing'` when the field is absent/invalid (resilient to a pre-field engine frame - do not
  reject the whole sim on a missing phase). Add the decode after the other field checks.

### 3b. World + scratch state

- `physics.ts` `LiveWorld`: add `phase: TeeterPhase;` and `phaseTicks: number;`. Import
  `TeeterPhase` from `./types`.
- `createWorld` args: add optional `phase?: TeeterPhase` and `phaseTicks?: number`; default to
  `'playing'` / `0` in the returned world.
- Add tuning constants in `physics.ts` (tick is ~40ms, spec 0044):
  `export const COMPLETE_TICKS = 40;` (~1.6s) and `export const INTRO_TICKS = 30;` (~1.2s).
- `teeter-tower.ts` `TeeterScratch`: add `phase: TeeterPhase; phaseTicks: number;`. Update
  `asScratch` (default `'playing'` / `0`), `snapshot`, and `rebuild` (pass them to `createWorld`).
  `configure`'s initial scratch: `phase: 'playing', phaseTicks: 0`.

### 3c. Tick logic (teeter-tower.ts `tick`)

Restructure so the height/score/clear block runs ONLY in `'playing'`. Order per tick:

1. If `world.over`: re-emit final snapshot (unchanged).
2. `stepWorld(world)`; if `sceneSettled(world)` refresh `world.stableHeight = worldHeight(world)`
   (unchanged - keep the tower visually alive during the pause).
3. `const level = levelAt(world.levelIndex)`.
4. If `world.phase === 'complete'`: `world.phaseTicks -= 1`. When `<= 0`:
   - if `world.levelIndex < LEVELS.length - 1`: `advanceLevel(world)`; `world.phase = 'intro'`;
     `world.phaseTicks = INTRO_TICKS`.
   - else: `world.over = true; world.next = null;` (final round done). Set `over = true` for the
     return so the world is retired + the summary shows.
   Return snapshot + sim (no piece offered).
5. If `world.phase === 'intro'`: `world.phaseTicks -= 1`. When `<= 0`: `world.phase = 'playing'`;
   `world.settleWaitTicks = 0`. Return snapshot + sim (no piece offered while intro is running;
   the next `'playing'` tick offers it via the existing block).
6. `'playing'`: keep the existing scoring block (priorScore/bestHeight/newScore/totalScore off
   `world.stableHeight`). Then, instead of the old `advanceLevel`/`over` branch:
   - if `world.stableHeight >= level.target`: enter the beat -> `world.phase = 'complete'`;
     `world.phaseTicks = COMPLETE_TICKS`; `world.next = null`. Return snapshot + sim (`over:false`).
     (Do NOT advance or set over here - the `'complete'` tick handles it.)
   - else: keep the existing "offer the next piece once settled or at the settle cap" block
     (`ensureNext`), then return.
- Keep the `over` handling that deletes the retired world (`worlds.delete(keyFor(ctx))`).
- `advanceLevel` is unchanged (it already resets tower/height/pieces). Do NOT set `phase` inside
  it; the tick sets `'intro'` after calling it.
- `startRound`: leave `phase = 'playing'` (round 1 opens immediately). `ensureNext` still runs.

### 3d. `toSim`

- Add `phase: world.phase` to the returned `TeeterSim`.

## Step 4 - Client round banners (Viewer.tsx)

- Read `sim.phase` (default `'playing'`).
- Add a centered DOM overlay (like `showStartHint`), shown over the canvas:
  - `phase === 'complete'`: big "Complete!" text.
  - `phase === 'intro'`: big "Round {level + 1}" with the level name (`LEVEL_NAMES[level]`).
  These are `pointer-events-none` so they never block input. Use theme classes (no hardcoded
  colors beyond the existing translucent-black hint pattern).
- The existing "settling" hint (`sim.next == null`) must NOT fire during `'complete'`/`'intro'`.
  Gate `settling` on `phase === 'playing'` (so `settling = sim.next == null && phase === 'playing'
  && !over`).
- Reflect the transition in the `srStatus` aria-live text: e.g. "Round complete." /
  "Round {n} - {name}." so the e2e and screen readers observe it.
- The aim button row already hides when `next == null` (isActive requires `next != null`), so no
  change needed there for the pause.

## Step 5 - Vertical aim + drop-at-line (Viewer.tsx, teeter-tower.ts, physics.ts)

### 5a. Vertical aim while spinning (Viewer.tsx)

- In `placedTransform`, the `spinning` branch: replace the fixed `spinGapY(live.requiredLine)`
  height with the cursor's `y`, clamped only to stay above the platform:
  `const y = Math.min(pointerRef.current.y, GROUND_TOP - 60);` (angle-independent -> no bob).
  Keep `x = clampDropX(pointerRef.current.x, live.platform.width)` and `legal: true`.
- Remove `SPIN_GAP` and the exported `spinGapY` (and its unit test) - now unused.
- `DEFAULT_AIM_Y` stays (fresh-piece starting height).

### 5b. Drop-at-line, non-blocking (Viewer.tsx)

- `placedTransform` `placing` branch: keep clamping the drawn `y` to `maxCentroidY` (bottom above
  the line), but return `legal: true` always (the clamp guarantees an above-line pose). Keep
  `rawBottom` for any callers/tests but it no longer gates the drop.
- `dropLegal`: becomes always true while `aim === 'placing'` (or remove and inline `true`).
- The Drop button: always enabled, label always "Drop" (remove "Too low"); aria-label always
  "Drop the piece". Remove the `disabled` on the placing branch.
- `drop()`: remove the `if (!t.legal) return;` guard (still submit the clamped pose).
- Update the aim hint + `srStatus` placing copy: KEEP the exact strings the e2e asserts -
  `'Move it into place, then Drop'` (hint) and `'move it into place, then Drop'` (status), and the
  spinning `'Move the piece, then Stop spin'` / status `'move the piece on the board, then Stop
  spin'`. Remove only the below-line branch ("the piece is below the line - move it higher").

### 5c. Server clamp-to-line (teeter-tower.ts, physics.ts)

- In `collectMove`, replace the `evaluatePlacement` line-rejection with a clamp:
  - compute the required line `lineY` (`requiredDropHeight(level.target, height)` ->
    `GROUND_TOP - reqH`, or null once all lines cleared).
  - build the held body at the clamped `dropX`/`dropY`/`angle`; if `lineY != null` and
    `held.bounds.max.y > lineY`, shift `dropY` up by `(held.bounds.max.y - lineY + 0.5)` and
    rebuild the held body (bottom now rests just above the line).
  - run the OVERLAP check only (a genuinely blocked spot still rejects with 'overlap'). The
    line is now always satisfied by construction.
  - `addPieceToWorld` with the clamped `dropY`.
- Simplest implementation: add a helper in `physics.ts`, e.g.
  `clampDropYToLine(body, lineY): number` returning the adjusted centroid y, or inline it in
  `collectMove`. `evaluatePlacement` may keep its line check as a defensive guard, but the
  clamped pose should never trip it. Do not remove the `'overlap'` path.
- The `'line'` rejection message + its `rejectionMessage` mapping can stay (harmless), or be
  dropped if fully unreachable - keep it to be safe.

## Step 6 - Tests

Update/add and keep the whole workspace green (`pnpm -w typecheck`, `lint`, `test`):

- `packages/games/teeter-tower/src/*.test.ts`:
  - Piece generation: `notchSide` + `notchBottom` appear in the stream for some index; each is
    concave (multi-part) and round-trips through `toStoredBodies` -> `createWorld` (rebuild) with
    matching geometry. Bag composition reflects the new weights (blocks/planks dominate; ell/blob/
    tri rare).
  - Floor friction: the platform + walls carry `FLOOR_FRICTION_STATIC`; pieces keep
    `PIECE_FRICTION_STATIC`.
  - Round transition: drive a world to clear a round and assert the `'playing' -> 'complete' ->
    'intro' -> 'playing'` sequence with the countdowns, `next` withheld during complete/intro, the
    next round active after intro, and the final round -> `'complete'` -> `over`. Assert
    `stableHeight`/scores behave. Reuse the existing test's seeding/harness.
  - Drop-at-line: a `collectMove` with a `dropY` below the line is ACCEPTED and the placed body
    sits above the line (was previously rejected 'line'). An overlapping drop still rejects.
- `apps/web/lib/games/teeter-tower/protocol.test.ts`: `asTeeterSim` decodes `phase`; defaults to
  `'playing'` when absent; a valid sim with each phase round-trips.
- `apps/web/lib/games/teeter-tower/Viewer.test.tsx`: remove the `spinGapY` test; the Drop button
  is enabled/`"Drop"` even for a low pointer (no "Too low"); the `'complete'`/`'intro'` banners +
  aria status render for those phases. Keep the exact spinning/placing copy the e2e relies on.
- `render.test.ts`: adjust only if a render helper changes.
- e2e `e2e/tests/teeter-tower.spec.ts`: the single-drop test never clears a round, so the
  transition beat does not affect it. Keep the asserted copy stable. Only touch it if a selector
  changed.

## Verification

- `pnpm --filter @branchout/teeter-tower test` and `pnpm --filter web test` green.
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm -w build` (or `format:check`) green (CI runs a
  prettier `format:check` that turbo can miss - run `pnpm format` if needed).
- Manual (insider surface): floor grip holds the base row; the two notch pieces appear; L/octagon/
  triangle are noticeably rarer; the spinning piece follows the cursor up/down with no bob; a
  below-line drop lands at the line; clearing a round shows "Complete!" then "Round 2".
