# 0044 - Teeter Tower: continuous, live server-authoritative physics

## Problem

Teeter Tower shipped (spec 0043) simulating each drop **once** on the server, streaming a keyframe
track, then **freezing** the tower. That removed the whole point of a physics stacker: in the
original prototype the world is **always live** - you commit a drop and then it is out of your hands;
the tower settles, sways, or topples on its own, continuously, and you do not get to respond. The v1
also fragmented the interactive surface (a Viewer canvas plus a Remote canvas with a slider) instead
of one board you manipulate directly.

## Outcome

- The tower is **continuously simulated** server-side and streamed live: a precarious tower keeps
  swaying (and can topple) in real time; every client sees the same live tower (still
  server-authoritative, the multiplayer goal from 0043).
- Interactive play is **one canvas** that is itself the controller: the piece spins on it, you tap to
  lock the angle, move on the canvas to position, and tap to drop. **No slider, no second canvas, no
  re-aim** - the drop is final.
- A piece must be **above the next 25% line measured from the tower's highest point** before it can
  drop (you cannot place low to play safe).
- Level 1 is **2x taller** (target 300 -> 600).

## Scope

**In:** a continuous per-session simulation + streaming loop in the engine (a new opt-in "live game"
capability); the Teeter module rewritten to own a live in-process world; the web collapsed to one
interactive, streamed canvas; the min-drop-from-top rule; level 1 height.
**Out:** worker-thread offload / broadcast throttling for the sim (noted follow-up); the prototype's
"out of pieces" lose state (deliberately deferred); final name/art. Turn-based games (Trivia, Liar
Liar) are untouched.

**Limit:** with no lose state in v1, the placed-body count is hard-capped (`MAX_PLACED_BODIES`, 60 -
comfortably above the summed level piece budgets) so a spammed stream of legal drops cannot grow the
world/snapshot without bound; a drop at the cap is rejected (`tower is full`).

## Approach

- **New wire frame `sim`** (`packages/protocol`): an opaque, game-defined live snapshot, broadcast on
  a cadence; the web reducer REPLACES its live state from each (never accumulates).
- **New SDK hook `GameModule.tick`** (`LiveTickResult { scratch, sim, over }`): implementing it marks
  a game live. The engine runs a ~25 fps per-session loop that calls `tick`, streams the `sim`, and
  ends the game on `over`; a live game stays in one live phase (moves accepted via `collectMove`,
  which now *applies* the drop to the world) and never runs the reveal/dispute/leaderboard cycle.
  Turn-based games (no `tick`) are unchanged.
- **Engine loop** (`apps/game-engine`): starts on game start, stops on pause/exit/complete, re-arms on
  host reconnect (mirrors the existing move-window timers); caches the last `sim` in-process and
  replays it on join for instant catch-up. The live world (Matter.js bodies) lives in-process per
  session; a compact snapshot in scratch rebuilds it after a restart.
- **Teeter module** (`packages/games/teeter-tower`): holds the live world; `collectMove` validates
  (turn, overlap, min-drop-from-top) then drops the piece into the running world; `tick` steps it,
  culls fallen pieces, updates height/score, advances the internal level on target, and reports
  `over` when the last level clears. `simulateDrop`/track deleted. Level 1 target 600.
- **Web** (`apps/web`): a `singleSurface` game renders one full-width interactive canvas (no Remote
  pane); it draws the streamed live tower (interpolated between frames) plus the locally-controlled
  aim piece, the target line, and the 25%-from-top drop line, and submits `{ angle, dropX, dropY }`.

## Acceptance

- [ ] The tower visibly sways in real time and a bad stack topples on its own - no freeze.
- [ ] One interactive canvas in interactive mode; on-canvas aim; no slider; no re-aim after a drop.
- [ ] A drop below the 25%-from-highest-point line is refused (server-authoritative).
- [ ] Level 1 is noticeably taller (600).
- [ ] Every client renders the same live tower (server-authoritative stream).
- [ ] `pnpm turbo typecheck lint test build` + `prettier --check .` green; e2e green; Trivia + Liar
      Liar unaffected.
