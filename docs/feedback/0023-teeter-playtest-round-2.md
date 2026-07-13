# 0023 - Teeter Tower playtest round 2 (L pieces, level 1 platform, aim UX)

## Symptom

Second playtest. Four asks:

1. **L pieces interact wonky** - the compound "ell" pieces overlap neighbours or leave gaps; every
   other (single-body) piece is fine.
2. **Level 1 too slippery** - make the platform full width with little **walls at the sides** so pieces
   do not slide off; make the **target 25% lower** (easier) - but do NOT change the viewport size.
3. **Aim UX** - tapping the canvas should only **move** the piece around (repeatedly, while it spins);
   a small **button in the top-right of the canvas** stops the spin, then becomes **Drop**.

## Root cause / design

1. **Ell round-trip.** `bodyFromStored` (physics.ts) rebuilds a compound body by
   `Body.create({ vertices: loop })` per part; Matter's `setVertices` re-centres each part's vertices
   on the origin, collapsing the L's two arms onto each other. The **collision** shape then differs
   from the **drawn** shape (which uses the original offset verts) -> visual overlap/gaps. Fix: create
   each part positioned at its loop's centroid so the arrangement survives the round-trip; add a
   round-trip test (localVerts -> bodyFromStored -> localVerts is stable, part offsets preserved).
2. **Level 1 platform.** Make the platform width + optional side walls per-level: level 1 = (near)
   full-width platform + short static side walls; levels 2/3 unchanged. Widen the drop-x clamp for the
   wider platform. Lower level 1 target 600 -> 450. Decouple the client's fit-to-level view from the
   target (fit a FIXED reference height) so lowering the target does not zoom the viewport.
3. **Aim UX.** Canvas tap/drag = position the piece (both phases). The piece spins continuously until a
   top-right on-canvas button stops the spin (locks the angle); that button then becomes Drop. Removes
   tap-to-lock + the double-tap guard.

## Fix

- Engine (packages/games/teeter-tower): fix `bodyFromStored` compound offsets; add per-level platform
  width + side walls (levels.ts + physics.ts); level 1 target 450; carry the platform config in the
  streamed `TeeterSim` so the client draws + clamps to it.
- Web (apps/web/lib/games/teeter-tower): draw the platform + walls from the sim; fit the view to a
  fixed reference height (not the target); rework the aim state machine so the canvas only moves the
  piece and a top-right button does stop-spin -> drop.

## Learning

Round-tripping a **compound** rigid body through per-part local vertices is not free: the physics
library re-centres each part, so the rebuild must explicitly restore each part's offset or the
collision shape silently drifts from the rendered shape. When a save/rebuild path exists (for
reconnect/worker restart), test the round-trip is an identity on the geometry, not just that it runs.
