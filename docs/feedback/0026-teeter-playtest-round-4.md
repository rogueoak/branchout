# 0026 - Teeter Tower playtest round 4 (fixed-height spin, hover aim, scene-hold, par)

## Symptom

Fourth playtest. Four asks:

1. **Spinning piece bobs on the line.** While a piece spins it rides just above the no-drop line, so as
   the line moves it bobs. It should sit at a FIXED height above the line while spinning (and may start
   above the finish line - that is fine).
2. **Mouse should aim without clicking.** With a cursor, the piece should follow the mouse as it moves
   over the canvas - no click-drag required.
3. **The line still jumps when things tumble.** The reported height/line should not resolve a new value
   until the pieces have stabilized; right now a tumbling tower jumps it around.
4. **Par per round.** Each round has a par (the pieces it should take). Past par, you lose 10 points per
   extra piece, and the running total can go negative.

## Root cause / design

1. **Fixed-height spin (client).** `placedTransform` clamped the spinning piece to `pointer.y` (default
   low, or the line when the line was high), so it rode/bobbed. While spinning, ignore `pointer.y` and
   place the piece at `requiredLine - span - SPIN_GAP` (a fixed gap above the line); the pointer still
   moves it left/right. Placing is unchanged (free follow, clamped above the line).
2. **Hover aim (client).** Round 3 (feedback 0025) added a drag-guard so a bare hover would NOT re-aim -
   that was only needed because the aim button sat ON the canvas (a mouse travelling to it dragged the
   piece to the corner). Round 3 moved the button ABOVE the canvas, so a mouse leaving the board can no
   longer drag the piece. Remove the guard: `handlePointerMove` follows the pointer on any move (a hover
   on a mouse, a drag on touch).
3. **Scene-hold height (engine).** Round 3's per-body settle-gate made `worldHeight` count only the
   settled subset, so during a TUMBLE the height (and line) still jumped as bodies moved in/out of the
   subset. Replace it: `worldHeight` is the raw current height again, and the tick refreshes a persisted
   `stableHeight` ONLY when the WHOLE scene is at rest (`sceneSettled`). Score, level-clear, the streamed
   line, and the drop-legality check all read `stableHeight`, so nothing resolves a new value mid-motion.
   A just-dropped body is stepped once (moving) before it is checked, so it never settles the height at
   its release point - the no-instant-win from round 3 is preserved.
4. **Par + penalty (engine + client).** Add a per-level `par`; track `piecesThisLevel` (resets each
   round); on a successful drop past par, subtract `PAR_PENALTY` (10) from `totalScore` (which may go
   negative). Stream `par` + `pieces` in the sim; the client HUD + aria-live show them and warn over par.

## Fix

- Engine (packages/games/teeter-tower): `sceneSettled` + a persisted `stableHeight` the tick refreshes
  only at rest; `worldHeight` reverts to raw; per-level `par` + `PAR_PENALTY`, `piecesThisLevel`, the
  over-par debit in `collectMove`; `par`/`pieces` added to `TeeterSim`.
- Web (apps/web/lib/games/teeter-tower): fixed-height spin in `placedTransform`; hover aim (drop the
  drag-guard); `par`/`pieces` in the sim decoder, the HUD pill, and the aria-live status (negative-safe).

## Learning

Two "measure at the right moment" lessons compound with round 3's. First, a per-body settle gate is not
the same as a scene-stable gate: counting the settled subset still moves as a tower tumbles - to hold a
value steady, gate on the WHOLE scene being at rest and HOLD the last value until then. Second, an input
guard added for one layout (an on-canvas button) becomes wrong once that layout changes (the button moved
off-canvas) - when you move a control, revisit the guards that only existed to protect the old position.
