# 0022 - Teeter Tower playtest round 1 (feel + layout)

## Symptom

First real phone playtest of the live Teeter Tower (spec 0043). Frame rate and mechanics feel good,
but six issues hurt it:

1. Placed pieces visibly intersect each other.
2. The next piece's default position is immediately invalid - it spawns *below* the required line and
   inside the existing pile.
3. Text selection is not disabled on the canvas, so dragging to aim highlights the UI and pops the
   iOS copy/paste menu.
4. The canvas is too short - it should use as much vertical space as possible (ideally viewport-tall).
5. Frame rate + mechanics feel good (keep).
6. The status badges above the canvas eat playable space; hide them.

## Root cause

- **#2 (and most of #1):** the spinning aim piece is drawn at the piece payload's fixed low position
  (`GROUND_TOP - SPAWN_Y`, world y = 440, ~100px above the platform). As the tower grows past that,
  the spinning piece hovers *inside* the pile and below the required line - so it reads as an invalid
  default and as "pieces intersecting" (the aim piece overlapping the tower).
- **#3:** the game-surface `div` sets no `user-select: none` / `-webkit-touch-callout: none`.
- **#4:** the surface is locked to `aspectRatio: 820/620` (wide + short) and
  `withWorldTransform` letterboxes (`scale = min(width/VIEW_W, height/VIEW_H)`), so a taller box just
  adds top/bottom bars instead of showing more of the tower.
- **#6:** the level/height/score and turn/aim hints are DOM badge rows stacked above the canvas.

## Fix

- **Aim spawn:** draw the spinning piece at the top of the current view (`cameraY + 80`, like the
  prototype), always clear of the tower and above the line. Placing already clamps the piece above the
  line, so only the spin display was wrong.
- **Fit-width, taller canvas:** `withWorldTransform` fits WIDTH (`scale = width/VIEW_W`) and maps
  `screenY = (worldY - cameraY) * scale`, so a tall canvas shows more vertical world (the tower) with
  no letterbox; the camera + `pointerToWorld` use the same mapping. The surface fills the viewport
  height (drop the fixed aspect-ratio; `user-select: none` + `touch-callout: none`).
- **HUD as overlay (#6):** draw a compact level/height/score HUD and the turn/aim hint as small
  screen-space overlays on the canvas, and remove the DOM badge rows - freeing the vertical space.
- **Intersections (#1):** re-check after the spawn fix (much of it is the low spinning piece); if
  settled placed bodies still overlap, tighten the drop-legality/step, but expect the spawn fix to
  resolve the visible case.

## Learning

**Run a game-feel change on a real phone before calling it done - and specifically watch the *default*
state of every turn.** The bug that most hurt the feel (an aim piece spawning inside the pile) is
invisible to unit tests and to a quick "does a drop work" check; it only shows once the tower has some
height. A canvas game's coordinate mapping (fit-width vs letterbox), its default spawn, and native
touch behaviors (text selection, callout, scroll) are first-class playability concerns, not polish.
