# 0027 - Teeter Tower playtest round 5 (spin bob, pause between pieces, fit-to-viewport, pause resume)

## Symptom

Fifth playtest. Four issues, three of them regressions/bugs in the live game:

1. **The spinning piece bobs** up and down constantly (a regression from `0026`'s fixed-height spin).
2. **The next piece appears before the last one has stabilized** - there should be a pause between
   pieces so a new piece is not presented while the previous one is still falling/bouncing.
3. **The page scrolls** - the running game should fit the screen. A scrolling page under a
   drag-to-aim canvas breaks immersion (a drag can scroll the page).
4. **Pausing while a piece is falling leaves it stuck in the air on resume** - it never continues.

## Root cause / fix

1. **Spin bob (client).** `0026`'s `spinGapY(requiredLine, spanMax)` subtracted the piece's ROTATED
   half-height (`spanMax = rotatedYSpan(piece, spinAngle)`), which changes every frame as the piece
   spins - so the centroid moved every frame. Fix: `spinGapY(requiredLine)` pins the CENTRE a fixed gap
   above the line, independent of the angle; the piece rotates in place with no vertical translation.
2. **Pause between pieces (engine).** `collectMove` set the next aim piece immediately. Now it clears
   `next` on a drop and the tick offers the next piece only once the tower has settled (`sceneSettled`),
   OR after a `MAX_SETTLE_TICKS` cap so a never-resting scene (the pendulum) can't withhold it forever.
   An empty/fresh scene (game start, new round) still offers the first piece at once.
3. **Fit to viewport (web).** For a single-surface game (Teeter) while running, the room view is now a
   fixed-height, non-scrolling flex column: `RoomClient`'s main is `h-[100svh] overflow-hidden`, the
   container/stage are `min-h-0 flex-1` columns, and the viewer board is `flex-1` (was a fixed `svh`
   calc that overflowed). The board fills the space between the compact header and the host bar; nothing
   scrolls. Multi-surface games (Trivia, Liar Liar) keep the normal scrolling page.
4. **Pause resume (client).** The interpolation window was `simArrived - prevArrived`. After a pause the
   gap between the last pre-pause frame and the first resumed frame is the WHOLE pause duration, so the
   fraction `(now - arrived)/span` crawled and the tower looked frozen. Cap the span
   (`MAX_INTERP_SPAN_MS`) so a long gap recovers within a couple of frames. (Server-side the paused world
   is cached and resumes stepping fine; the freeze was purely the client's interpolation math.)

## Fix

- Web (apps/web): `spinGapY` angle-independent; interpolation span cap; single-surface running view
  fits the viewport (RoomClient + GameStage + Viewer flex-fill).
- Engine (packages/games/teeter-tower): `next` cleared on drop, re-offered after the tower settles (or a
  bounded cap) via an in-memory `settleWaitTicks`.

## Learning

Two "derived-from-a-changing-input" traps and one "gap makes a ratio explode" trap. A hover height that
subtracts a value which itself changes each frame (the rotated span) reintroduces the very motion it was
meant to remove - pin to a constant when you want "no movement". And any wall-clock-normalized
interpolation must CAP its denominator: a pause (or a dropped-frame gap) makes the inter-frame span
huge, which silently freezes the animation on resume. Cap the span, or the ratio does the opposite of
smoothing.
