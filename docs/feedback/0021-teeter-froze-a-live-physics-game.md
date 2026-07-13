# 0021 - Teeter Tower v1 froze a live physics game into a one-shot settle

## Symptom

The shipped Teeter Tower (spec 0043) felt wrong: the tower did not sway, could not topple on its own,
and the interactive surface had a slider and a second canvas. The developer's blunt note: "the game
is not in a good place... did you read the original code? This was a baked in decision."

## Root cause

Reframing the prototype as "server-authoritative" was correct, but I implemented authority as a
**one-shot** operation: simulate the drop to a settled rest pose, stream a keyframe track, freeze. The
prototype's baked-in design is the opposite - a **continuously running** physics world where a
committed drop plays out on its own and you do not get to respond. I preserved the wrong half
(authority) and discarded the half that IS the game (continuous, live, unrecoverable physics). I also
over-fit the platform's Viewer/Remote split onto a game that wants a single direct-manipulation
surface.

## Fix

Spec 0044: a continuous per-session simulation + streaming loop in the engine (a new opt-in "live
game" capability via `GameModule.tick` + a `sim` frame). The Teeter world runs live and streams; the
web collapses to one interactive canvas. Server-authoritative AND continuous, so multiplayer still
sees one shared, live tower.

## Learning

**When porting an existing game, the source's runtime model is a requirement, not an implementation
detail.** A physics game whose original runs a continuous simulation loop must stay continuous -
"simulate once and freeze" is a different game, even if every rule matches. Before re-architecting a
port (e.g. client -> server authority), name the source's load-bearing runtime properties (continuous
vs turn-based, can-you-undo, who-owns-the-loop) and preserve them; only then choose where the loop
runs. Also: do not force a game onto the platform's default UI decomposition (viewer + remote) when
the game is a single direct-manipulation surface - carry a `singleSurface` seam instead. And run and
watch a game-feel change before shipping it; unit tests pass while the feel is gone.
