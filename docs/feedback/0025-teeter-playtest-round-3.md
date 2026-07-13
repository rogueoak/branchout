# 0025 - Teeter Tower playtest round 3 (settle-gate, aim button, points-only, "Round")

## Symptom

Third playtest. Four asks:

1. **Height counts unsettled pieces.** Dropping a piece above the goal line wins immediately, because the
   tower height (which drives score + level-clear + the min-drop line) is sampled every tick including a
   piece still in free-fall - so its airborne arc peak counts. Same cause makes the "no-drop line" jump
   around as the piece falls. (This is the deferred issue from `0024` #2, now in scope.)
2. **Aim button overlaps the on-canvas hint.** Move the Stop-spin/Drop button to a bar just ABOVE the
   canvas. Let a double-tap (double-click on desktop) count as pressing that button. At the start of the
   game, show centered text on the canvas: "Double tap to stop spin and drop" (touch) / "Click to stop
   spin and drop" (desktop).
3. **Drop the "px" readout.** The HUD shows both a `px` height and a points score; keep only the points.
4. **"Round", not "Level".** Rename the player-facing "Level" / "Lv N" label to "Round N".

## Root cause / design

1. **Settle-gate the height.** `worldHeight` (physics.ts) took `min(bounds.min.y)` over ALL placed
   bodies, including one still moving. Count only SETTLED bodies (linear + angular speed below a small
   threshold), so a falling piece contributes nothing until it comes to rest. That single change fixes
   score, level-clear (`height >= target`), AND the streamed `requiredLine` (the min-drop line) at once,
   since all three read `worldHeight`. A just-dropped piece has already been stepped once under gravity
   before it is measured, so it never counts at its release height.
2. **Aim button + double-tap.** Lift the button out of the canvas overlay into a row above the board, so
   it can never sit on the hint. Detect a double-tap on the board (two quick taps / a double-click) and
   fire the same action as the button, guarded by the same "too low" disable so it cannot drop illegally.
   A start-of-game centered overlay (shown until the first piece lands) teaches the gesture, with copy
   that switches on `(pointer: coarse)` (touch vs. mouse).
3. **Points-only HUD.** Remove the `N/target px` line from the HUD pill, the over-screen summary, and the
   aria-live status; keep the points score and the points target line/bands. (Height still drives the
   mechanic server-side; it is just no longer surfaced as a number.)
4. **"Round" label.** Player-facing rename only (HUD + aria-live); the engine's internal `levelIndex`
   is unchanged. Note the collision with the credit/"rounds" count (the piece budget) is internal-only
   and not player-visible, so the display rename does not conflict.

## Fix

- Engine (packages/games/teeter-tower): `worldHeight` counts only at-rest bodies (`SETTLE_SPEED` /
  `SETTLE_ANGULAR`); regression test drops a piece above target that settles below and asserts no
  instant clear + a stable min-drop line.
- Web (apps/web/lib/games/teeter-tower): button moved above the canvas; double-tap/double-click shortcut;
  start-of-game centered hint (touch/mouse copy); HUD/over/aria-live drop the px readout and say "Round".

## Learning

A continuously-stepped physics world must decide WHEN a measurement is valid, not just what it measures:
sampling instantaneous height every tick rewards the drop height, not the built height. Gate the read on
"at rest" (speed below a threshold) so transient motion never scores. And on a mobile-first surface, an
on-canvas control competes with on-canvas text for the same pixels - lift controls into real DOM chrome
above the play surface, and offer a big-target gesture (double-tap) so the player never has to reach a
corner button mid-play.
