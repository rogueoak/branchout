# 0043 - Teeter Tower: continuous, live server-authoritative physics game (insider-only)

## Problem

We want to try a new game - working title **Teeter Tower**, a physics stacking game - in front of
insider testers to validate the core mechanic before investing further. It must be a *real* game on
our platform (lobby, config, rounds, WebSocket), playable solo for now but built so multiplayer
"everyone sees the same tower" works later. A vanilla-JS + Matter.js prototype exists at
`../prototypes/teeter-tower`. It ships behind the existing insider surface (spec 0035) so it never
touches the public catalog until it is ready.

The heart of the game is that the world is **always live**: you commit a drop and then it is out of
your hands; the tower settles, sways, or topples on its own, continuously, and you do not get to
respond. Interactive play is **one board you manipulate directly** - not a viewer canvas plus a
separate remote with a slider.

## Outcome

- An insider can create a room, pick **Teeter Tower** (visible only to insiders), start it solo, and
  play: a googly-eyed piece spins, they lock its angle, choose a drop position, and drop it into a
  **live** tower that keeps settling, swaying, and (if precarious) toppling in real time; they climb
  toward a target height across the prototype's three levels (warm-up -> higher -> pendulum). Score
  and height update continuously as the world runs.
- Physics runs **server-side, authoritative, and continuous** in the game-engine (headless
  Matter.js): a per-session live world is stepped on a ~25 fps loop and streamed live, so every
  client renders the identical live tower. The browser is a **renderer**, not a physics engine.
- Interactive play is **one canvas that is itself the controller**: the piece spins on it, you tap to
  lock the angle, move on the canvas to position, and tap to drop. **No slider, no second canvas, no
  re-aim** - the drop is final.
- A piece must be **above the next 25% line measured from the tower's highest point** before it can
  drop (you cannot place low to play safe). Level 1's target is **600** (2x the prototype's 300).
- The game is absent from the public game picker, public game pages, and the sitemap. A non-insider
  cannot see or start it; a signed-out visitor to the insider surface is bounced to apex login.
- Built on the `move` turn channel (spec 0042): a turn's submission is `{ angle, dropX, dropY }`.

## Scope

**In:** a new engine game plugin (`packages/games/teeter-tower`) with a deterministic headless
**continuous** simulation; a new opt-in engine "live game" capability (a per-session tick + stream
loop) it runs on; its web UI module (a single interactive, streamed canvas) that renders server
payloads; a game `visibility` flag that gates the picker + engine start to insiders; the
min-drop-from-top rule and level 1 height; a brand mark + copy; unit + e2e tests; docs.

**Out:** real multiplayer turn-taking rules and spectator UX (the turn abstraction is built -
active player = `round % players` - but the multi-human flow is not built/e2e'd here); the
prototype's "out of pieces" lose state (deliberately deferred); sounds; score
persistence/leaderboards; worker-thread offload and broadcast throttling for the sim (noted
follow-up, taken up by spec 0045); final name/art. Turn-based games (Trivia, Liar Liar) are
untouched.

**Limit:** with no lose state, the placed-body count is hard-capped (`MAX_PLACED_BODIES`, 60 -
comfortably above the summed level piece budgets) so a spammed stream of legal drops cannot grow the
world/snapshot without bound; a drop at the cap is rejected (`tower is full`).

## Approach

### Live-game capability (opt-in, fits the existing engine)
- **New wire frame `sim`** (`packages/protocol`): an opaque, game-defined live snapshot, broadcast on
  a cadence; the web reducer REPLACES its live state from each (never accumulates).
- **New SDK hook `GameModule.tick`** (`LiveTickResult { scratch, sim, over }`): implementing it marks
  a game live. The engine runs a ~25 fps per-session loop that calls `tick`, streams the `sim`, and
  ends the game on `over`; a live game stays in one live phase (moves accepted via `collectMove`,
  which *applies* the drop to the world) and never runs the reveal/dispute/leaderboard cycle.
  Turn-based games (no `tick`) are unchanged.
- **Engine loop** (`apps/game-engine`): starts on game start, stops on pause/exit/complete, re-arms on
  host reconnect (mirrors the existing move-window timers); caches the last `sim` in-process and
  replays it on join for instant catch-up. The live world (Matter.js bodies) lives in-process per
  session; a compact snapshot in scratch (seed + placed bodies) rebuilds it after a restart.

### Engine game - `packages/games/teeter-tower` (headless, deterministic, live)
Port the prototype's shape generation, levels, legality, scoring, pendulum, and physics into a pure
`GameModule` that owns a **live in-process world** (matter-js core `Engine`/`Bodies`/`Composite`/
`Query`; no DOM). Determinism from seeded `services.rng` + fixed timestep, so the single server
simulation is reproducible and clients render exactly what the server computed. `configure` derives
and persists the seed once.
- `collectMove(ctx, player, move)`: parse `{ angle, dropX, dropY }`; **reject** (targeted
  `move_rejected`) when the sender is not the active player, the placement is illegal (overlaps the
  tower/platform), the piece is **below the next 25% line from the tower's highest point**, or the
  tower is at `MAX_PLACED_BODIES`; otherwise drop the piece into the running world.
- `tick`: step the world, cull fallen pieces, update the stored tower + height + score, advance the
  internal level when the target is reached, and report `over` when the last level clears. Level 1
  target is 600.

### Wire payloads (opaque to the engine; the web module decodes them)
- **sim** (per tick): the live snapshot - `{ tower: Body[], piece?, height, score, level, target, ... }`
  where `Body` = `{ id, verts: [{x,y}][], x, y, angle, skin, eyes }` (world-space; a late joiner
  renders the whole live tower from one frame).
- **move** (client -> engine, as the `move` string): `JSON.stringify({ angle, dropX, dropY })`.

### Web UI - `apps/web/lib/games/teeter-tower/` (renderer only, no browser physics)
- A `singleSurface` game renders **one full-width interactive canvas** (no separate Viewer/Remote
  panes). It draws the streamed live tower (interpolated between frames) plus the locally-controlled
  aim piece, the target line, and the 25%-from-top drop line; **mobile-first** (usable at ~360px,
  `touch-action: none`, aspect-ratio scaling), Branch Out theme tokens. The active player spins to
  pick the angle on the canvas, moves to position, and taps to drop, submitting `{ angle, dropX,
  dropY }` via `onMove`; a non-active player sees a "watching" state. Aiming is local drawing only;
  the server is authoritative and rejects illegal drops (surfaced via the reducer's `rejected`).
- `ConfigPanel`: minimal (starts on defaults).

### Insider gating (reuse the normal flow)
- Add `visibility?: 'public' | 'insider'` to the web `GameUiModule` and the engine `GameManifest`.
- Filter the room-create picker by the viewer's `insider` role; only insiders select/start it. Add a
  catalog entry marked insider/noindex so the build-time "every registered game needs marketing copy"
  check passes without exposing it publicly.

### Branding + tests + docs
- `assets/game-teeter-tower.svg` -> `packages/brand/src/teeter-tower.ts` (+ tsup entry + package
  export); the UI module's `icon` reads it. Name/tagline/summary/how-to in Trellis `language.md` voice.
- **Unit:** engine determinism (same seed + moves -> identical tower/score), scoring/height, move
  rejection (non-active, illegal, below the 25%-from-top line, cap), level transition; web
  registry/reducer + visibility filtering.
- **e2e (Playwright):** extend the insider suite (`grantInsider` in `e2e/lib/stack.ts`) - a granted
  insider creates a room, sees Teeter in the picker (a non-insider does not), starts solo, drops a
  piece, and the canvas shows the tower grow + score update on the live stream.
- Reflect (Spectra 6): `docs/overview/features.md` (new game) + `architecture.md` (continuous
  server-side physics + live `sim` stream + `visibility` gating).

## Acceptance

- [ ] Insider plays a solo Teeter round end to end on `insider.*`; the tower visibly sways in real
      time and a bad stack topples on its own - no freeze; tower + score update from the
      server-simulated live world.
- [ ] One interactive canvas in interactive mode; on-canvas aim; no slider; no re-aim after a drop.
- [ ] A drop below the 25%-from-highest-point line is refused (server-authoritative); level 1 is
      noticeably taller (600).
- [ ] Non-insider cannot see or start it; it is absent from public picker/pages/sitemap.
- [ ] Server simulation is deterministic (unit test) and authoritative (client runs no physics);
      every client renders the same live tower.
- [ ] Mobile-first at ~360px; touch aiming works.
- [ ] `pnpm turbo typecheck lint test build` + `prettier --check .` green; e2e green; Trivia + Liar
      Liar unaffected.
