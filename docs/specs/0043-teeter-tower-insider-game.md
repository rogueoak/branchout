# 0043 - Teeter Tower: engine-authoritative physics game (insider-only)

## Problem

We want to try a new game - working title **Teeter Tower**, a physics stacking game - in front of
insider testers to validate the core mechanic before investing further. It must be a *real* game on
our platform (lobby, config, rounds, WebSocket), playable solo for now but built so multiplayer
"everyone sees the same tower" works later. A vanilla-JS + Matter.js prototype exists at
`../prototypes/teeter-tower`. It ships behind the existing insider surface (spec 0035) so it never
touches the public catalog until it is ready.

## Outcome

- An insider can create a room, pick **Teeter Tower** (visible only to insiders), start it solo, and
  play: a googly-eyed piece spins, they lock its angle, choose a drop position, and the tower
  settles under gravity; they climb toward a target height across the prototype's three levels
  (warm-up -> higher -> pendulum). Score and height update as they build.
- Physics runs **server-side and authoritative** in the game-engine (headless Matter.js). Each drop
  is simulated once; the engine broadcasts the settle so every client renders the identical tower.
  The browser is a **renderer**, not a physics engine.
- The game is absent from the public game picker, public game pages, and the sitemap. A non-insider
  cannot see or start it; a signed-out visitor to the insider surface is bounced to apex login.
- Built on the `move` turn channel (spec 0042): a turn's submission is `{ angle, dropX }`.

## Scope

**In:** a new engine game plugin (`packages/games/teeter-tower`) with a deterministic headless
simulation; its web UI module (Viewer/Remote/ConfigPanel) that renders server payloads; a game
`visibility` flag that gates the picker + engine start to insiders; a brand mark + copy; unit + e2e
tests; docs.

**Out:** real multiplayer turn-taking rules and spectator UX (the turn abstraction is built -
active player = `round % players` - but the multi-human flow is not built/e2e'd here); sounds; score
persistence/leaderboards; worker-thread offload and track compression for the sim; final name/art.

## Approach

### Turn model (fits the existing engine; no engine changes)
- **One piece-drop = one round.** The engine only streams a game payload at `reveal`, so each drop
  is its own round. `configure` returns `rounds` = total pieces across the three levels; `scratch`
  holds the authoritative tower + level index + RNG seed, so the 3 levels are internal progression
  the engine need not know about.
- **Continuous feel without a manual interstitial.** `configure` sets a short `disputeWindowMs`;
  `disputeWindow` returns no disputes, so `disputing` auto-closes to `leaderboard` server-side. The
  `leaderboard` phase is the "tower settled, next piece ready" rest state; the Teeter client (the
  solo player is the room host) issues the existing host `advance` control to spawn the next piece.
  `moveWindowMs = 0` (the player takes their time aiming; `allSubmitted` closes `collecting` once the
  active player's single move is in).

### Engine game - `packages/games/teeter-tower` (headless, deterministic)
Port the prototype's shape generation, levels, legality, scoring, pendulum, and settle detection into
a pure `GameModule` (matter-js core `Engine`/`Bodies`/`Composite`/`Query`; no DOM). Determinism from
seeded `services.rng` + fixed timestep + capped steps, so the single server simulation is
reproducible and clients render exactly what the server computed.
- `startRound`: pick active player, spawn the next piece deterministically, emit the prompt (below).
- `collectMove(ctx, player, move)`: parse `{ angle, dropX }`; **reject** (targeted `move_rejected`)
  when the sender is not the active player or the placement is illegal (overlaps the tower/platform,
  or below the level's next min-drop line - ports `overlapsScene`/`evaluatePlacement`).
- `reveal`: build the world from the stored tower, drop the piece at `{ angle, dropX }`, simulate to
  settle recording a keyframe track, cull fallen pieces, update the stored tower + height + score,
  and advance the internal level when the target is reached. Emit the reveal (below) + score delta.
- `leaderboard`/`advance`/`endGame`: standard; `advance` ends the game when `round >= rounds`.

### Wire payloads (opaque to the engine; the web module decodes them)
- **prompt** (per round): `{ round, level, target, height, activePlayer, tower: Body[], piece: Piece }`
  - `Body` = `{ id, verts: [{x,y}][], x, y, angle, skin, eyes }` (world-space; a late joiner renders
    the whole tower from this one frame).
  - `Piece` = the piece being aimed: local `verts`, `eyes`, `skin`, spawn `x/y`, spin seed.
- **move** (client -> engine, as the `move` string): `JSON.stringify({ angle, dropX })`.
- **reveal** (per drop): `{ track: Frame[], tower: Body[], height, score, level, target, cleared }`
  where `Frame` = `{ t, bodies: [{ id, x, y, angle }] }` - the settle animation the client plays back.

### Web UI - `apps/web/lib/games/teeter-tower/` (renderer only, no browser physics)
- `Viewer`: a `<canvas>` that draws the tower from `prompt`/`reveal`, plays the settle `track` on a
  new reveal, overlays the target line / score bands / googly eyes; **mobile-first** (usable at
  ~360px, `touch-action: none`, aspect-ratio scaling), Branch Out theme tokens. On entering
  `leaderboard` (after the settle plays) it advances (host) to the next piece for continuous flow.
- `Remote` (active player): spin to pick the angle, drag to pick `dropX`, submit `{ angle, dropX }`
  via `onMove`; a non-active player sees a "watching" state. Aiming is local drawing only; the
  server is authoritative and rejects illegal drops (surfaced via the reducer's `rejected`).
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
  rejection (non-active, illegal), level transition; web registry/reducer + visibility filtering.
- **e2e (Playwright):** extend the insider suite (`grantInsider` in `e2e/lib/stack.ts`) - a granted
  insider creates a room, sees Teeter in the picker (a non-insider does not), starts solo, drops a
  piece, and the Viewer shows the tower grow + score update.
- Reflect (Spectra 6): `docs/overview/features.md` (new game) + `architecture.md` (server-side
  physics + streamed-track reveal + `visibility` gating).

## Acceptance

- [ ] Insider plays a solo Teeter round end to end on `insider.*`; tower + score update from the
      server-simulated settle.
- [ ] Non-insider cannot see or start it; it is absent from public picker/pages/sitemap.
- [ ] Server simulation is deterministic (unit test) and authoritative (client runs no physics).
- [ ] Mobile-first at ~360px; touch aiming works.
- [ ] `pnpm build`/`test`/`lint`/`typecheck` green; e2e green; existing games unaffected.
