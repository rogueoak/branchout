# 0032 - Teeter Tower playtest round 7

Six items from a live playtest: floor grip, the piece mix (two new "notch" pieces + rarer hard
shapes), vertical aim while spinning, a round-transition beat, and a non-blocking below-the-line
drop. Ported into the live game (spec `0044`) and its web surface.

## Symptom (per item)

1. **Pieces slide along the floor.** After round 6 (feedback `0028`) the pieces grip *each other*
   well, but the bottom row still creeps/slides along the platform surface - "too sticky to each
   other, not sticky enough to the floor." Ask: increase the floor friction specifically.
2. **Shape mix is stale.** Remove one of the octagon-style pieces and add a piece with an internal
   (concave) angle on one edge. Per the developer: add TWO - a **side-notch** block and a
   **bottom-notch** block.
3. **Can't aim vertically while spinning.** While the piece spins, moving the cursor vertically
   does nothing (the piece is pinned to a fixed height, feedback `0027`); the player expects the
   spinning piece to follow the cursor up/down too.
4. **Round change is abrupt.** Clearing a round jumps straight into the next one. Ask: pause a
   beat and show "Complete!", then show a brief "Round X" as the next round begins.
5. **Below-the-line drop is blocked.** Trying to drop below the required line disables the Drop
   button ("Too low") and refuses the drop. Ask: don't block it - just drop it at line height.
6. **Hard pieces too frequent.** The L, octagon (blob), and triangle pieces are hard; they should
   show up sparingly, not on a large share of drops.

## Root cause / design

### 1. Floor grip (kinetic vs static, and how Matter combines a pair)

`makePlatform`/`makeWalls` set the platform + walls to the *same* `PIECE_FRICTION` /
`PIECE_FRICTION_STATIC` as the pieces. Matter combines a contact pair as
`friction = min(a, b)` (kinetic) and `frictionStatic = max(a, b)` (static). So:

- Raising the floor's **kinetic** friction past the piece's is inert - `min(3.0, floor)` stays
  `3.0`, capped by the piece. And the piece's kinetic friction is shared with piece-on-piece
  contact, which the developer says is already too grippy - so we must not raise it.
- Raising the floor's **static** friction *does* grip the floor contact independently, via `max`:
  `frictionStatic(piece-on-floor) = max(30, floorStatic)`, while `piece-on-piece` stays `30`.
  Static friction is the force to break a resting piece free - exactly the "bottom row creeps
  along the platform" regime.

Fix: give the floor its own, much higher static friction, leaving piece-on-piece untouched.

- New `FLOOR_FRICTION_STATIC = 80` (was the shared `30`), applied to the platform and the side
  walls. Kinetic floor friction stays at `PIECE_FRICTION` (min-combined, so equal to piece-piece;
  raising it would be inert).

This is a floor-only lever: piece-on-piece grip is unchanged, so we address "slides on the floor"
without making pieces even stickier to each other.

### 2 + 6. Piece mix: two new notch pieces, hard shapes made rare

The type bag was `block x2, plank x2, ell x2, blob x1, tri x1, trap x1` (9). The "hard" shapes the
developer named are `ell` (L), `blob` (octagon), and `tri` (triangle). New bag (12), per the
developer's chosen mix:

```
block x3, plank x3, notch-side x1, notch-bottom x1, trap x1, ell x1, blob x1, tri x1
```

- Blocks + planks (the reliable, easy-to-stack pieces) dominate.
- `ell`, `blob`, `tri` drop to one slot each - each shows up occasionally, not routinely (item 6),
  and blob's share falls from 1/9 to 1/12 (item 2's "remove one octagon-style").
- Two new pieces, each a concave rectangle with **one internal angle on one edge** (item 2):
  - **notch-side**: a rectangle with a notch cut into one vertical edge. Flat bottom - rests
    stably, interlocks sideways.
  - **notch-bottom**: a rectangle with a V-notch cut into the bottom edge. Two feet + one concave
    apex - a touch trickier to seat.
  Both are single concave polygons built via `Bodies.fromVertices` (poly-decomp is already wired,
  like `blob`), so they round-trip through the stored-body snapshot as decomposed convex parts
  exactly the way `blob` already does.

### 3. Vertical aim while spinning

Feedback `0027` pinned the spinning piece's centre to a fixed height (`requiredLine - SPIN_GAP`)
to kill the spin-induced bob. That fix pinned it to a *constant* - good - but also stopped it
following the cursor vertically. The bob came from deriving the height off the *rotated span*
(which changes each frame); the cursor's `pointer.y` is angle-independent, so following it
introduces no bob. Fix: while spinning, the centre follows `pointer.y` (clamped only to stay above
the platform, `GROUND_TOP - 60`, angle-independent so still bob-free), not a fixed gap. `SPIN_GAP`
/ `spinGapY` are removed. The starting `pointer.y` (`DEFAULT_AIM_Y`) still places the fresh piece
clearly above the tower until the player moves it.

### 4. Round-transition beat (server-authoritative)

The server jumps `advanceLevel` the instant `stableHeight >= target`. A pause the player can see
must be real (it holds the physics + withholds the next piece), so it belongs on the authoritative
server, not a client animation. Add a small phase machine to the live world:

- `phase: 'playing' | 'complete' | 'intro'` (+ `phaseTicks` countdown), persisted in scratch so a
  reconnect mid-transition shows the right banner, and streamed on `TeeterSim.phase`.
- On clearing a non-final round (in `'playing'`): enter `'complete'` for `COMPLETE_TICKS` (~1.6s),
  holding the settled tower and withholding the next piece; the client paints "Complete!".
- When `'complete'` elapses: `advanceLevel`, enter `'intro'` for `INTRO_TICKS` (~1.2s) over the
  fresh empty tower; the client paints "Round X - <name>". When `'intro'` elapses: back to
  `'playing'` and the first piece is offered.
- The final round routes through `'complete'` too (show "Complete!"), then `over` -> the existing
  summary. Round 1's opening stays immediate (`'playing'`), so the game-start flow and the e2e are
  unchanged - the beat is only *between* rounds, which is what the ask is about.

### 5. Below-the-line drop -> clamp, don't block

The client disabled Drop and refused a below-line pose; the server rejected it (`reason: 'line'`).
Make it non-blocking end to end:

- Client: the placing ghost already clamps its drawn `y` to sit above the line. Drop the "Too low"
  state - Drop is always enabled and submits that clamped (at-line) pose. Ghost never reddens for
  the line.
- Server: instead of rejecting a below-line drop, **clamp `dropY` up** so the piece's bottom rests
  just above the line, then run the overlap check. (Clamping *up* moves the piece away from the
  tower, so it cannot introduce an overlap.) The overlap guard still rejects a genuinely blocked
  spot; only the line rule becomes a clamp.

## Fix

`packages/games/teeter-tower/src/levels.ts`, `physics.ts`, `teeter-tower.ts`, `types.ts`;
`apps/web/lib/games/teeter-tower/protocol.ts`, `Viewer.tsx`, `render.ts`. Full step list +
verification in `docs/plans/0032-teeter-playtest-round-7.md`.

## Learning

- **Matter combines a contact pair's friction with `min` (kinetic) and `frictionStatic` with
  `max` - so a floor-only grip increase is a `frictionStatic` bump on the floor, not a kinetic
  one.** Raising the floor's kinetic friction above the piece's does nothing (`min` caps it at the
  piece), and the piece's kinetic friction is shared with piece-on-piece; to grip the *floor*
  without touching piece-on-piece, raise the floor's **static** friction (combined by `max`, so it
  wins the pair independently). Know the combine rule before you pick the lever. (Generalizes
  feedback `0028`'s kinetic-vs-static lesson to the pair-combination rule.)
- **A pause the player must perceive has to be server-authoritative in a live game - it holds the
  sim and gates the next input, not just a client overlay.** Modeling "Complete!/Round X" as a
  phase on the streamed world (with a persisted countdown) keeps a reconnect and every client in
  sync; a client-only banner would race the server's instant advance and desync a rejoin.

## Review addendum (PR #94)

Persona review (engineer/tester/architect/security/user-player) found no blockers; the design
(phase machine, floor-friction lever, server drop-clamp, concave pieces) was confirmed sound. Two
**major** findings, both test-coverage gaps, were fixed before merge and generalized into
`overview/learnings.md`:

- The headline **vertical-aim** behavior had no test - its math was inlined into the unexported
  canvas-draw closure (jsdom can't run it). Fixed by re-extracting pure exported `spinAimY` /
  `placeAimY` helpers and unit-testing them. Lesson: keep the testable seam when you change loop-only
  logic; don't inline a tested helper away.
- The **notch-piece** tests keyed on concave-part count, which `blob`/`ell` already satisfy, so
  removing a notch stayed green. Fixed by exposing a non-wire `GeneratedPiece.type` and asserting the
  mix by type. Lesson: assert the discriminating attribute, not a property other cases share.

Minor/nit fixes folded in: guard the intro banner subtitle against duplicating the "Round N" title
past the named levels; centralize the min-drop world-y in a `lineYFor` helper.
</content>
</invoke>
