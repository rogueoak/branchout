# 0054 - Reversi: the classic disc-flip board game (insider-only), and the reusable board harness

## Problem

We want to bring real, two-player abstract board games to the platform, starting with **Reversi**
(the classic 8x8 disc-flip strategy game). Reversi is the **first** board game, so beyond shipping the
game itself we need to establish a clean, reusable **board harness** - turn management, a serializable
grid, move validation, board-in-scratch, and a single-surface board renderer - that **Checkers and
Chess** can follow without re-inventing it. The game ships behind the existing insider surface
(spec 0043) so it stays off the public catalog until it is ready.

Reversi is a **perfect-information** game: the whole board is public, so it does NOT need the
per-player private channel (spec 0052). And its "physics" is just board logic - fully serializable -
so unlike Teeter Tower (spec 0044) it holds **no in-process world** (no Matter.js), which means no
`disposeLive` to release.

## Outcome

- Two insiders can create a room, pick **Reversi** (visible only on the insider surface), and play a
  full game on **one shared board**: Violet (the first player) and Amber alternate placing discs; a
  legal placement brackets one or more straight lines of the opponent's discs and **flips** every
  bracketed disc to the mover's color; a player **must move** if they have a legal move, otherwise
  their turn is **passed**; the game ends when **neither** side can move, and the **most discs** wins.
- The board is **server-authoritative**: the engine holds the board, turn, and pass-state in scratch
  and streams the whole board on the `sim` frame whenever it changes. The browser is a pure **renderer
  + input surface**: it draws the streamed board and, on the local player's turn, taps an empty legal
  square to submit a placement. An illegal or out-of-turn tap is rejected by the engine **to that one
  device** (never a broadcast).
- Interactive play is **one canvas that is itself the controller** (`singleSurface: true`): the shell
  renders only the Viewer and passes `onMove` through; there is no separate Remote.
- The presentation is themed to Branch Out: **Violet vs Amber** leaf discs (canopy grape/sunbeam
  tokens, no hardcoded brand hex) on a **wood-grain** board. The game keeps its generic name Reversi;
  no trademarked branding is referenced.
- The board machinery (grid, coordinates + the eight compass rays, two-seat turn management, the
  single-surface board renderer's layout + tap hit-test) is factored **separately** from Reversi's
  rules, so Checkers and Chess reuse it.
- The game is absent from the public game picker, public game pages, and the sitemap; a non-insider
  cannot see or start it, and an insider on the apex surface does not see it either.

## Scope

**In:**
- A new engine game plugin `packages/games/reversi` (LIVE model) with:
  - a reusable, game-agnostic **board harness** (`board.ts`): a serializable `Grid<T>`, coordinate +
    eight-direction ray helpers, and two-seat `Turns` management;
  - Reversi's **pure rules** (`rules.ts`): the opening, legal-move generation, the flip/bracket logic
    in all eight directions, forced-pass detection, end detection, and disc-count scoring;
  - the LIVE module (`reversi.ts`): board + turn + pass-state in scratch, `collectMove` validating a
    placement (turn + legality, rejecting illegal/out-of-turn to the device), `tick` streaming the
    board on change, `over` when neither can move, and custom 2-player standings by disc count.
- Registration in the game engine (`index.ts` + `worker/game-worker.ts`, kept in sync) and its
  dependency.
- The web UI module `apps/web/lib/games/reversi` (`singleSurface`): a protocol decoder, a reusable
  single-surface **board renderer** (`board-render.ts`: layout, screen<->cell mapping, theme-token
  chrome), the tap-to-place Viewer, a null Remote, and a no-config ConfigPanel; registry + marketing
  catalog + library entries.
- A brand mark (`packages/brand/src/reversi.ts` + the `./reversi` export + tsup entry): an oak
  skeleton bent to a two-tone disc/board motif carrying the single gold root `#d2a463`.
- Tests: deterministic engine unit tests (rules + module), web component tests (renderer + decoder +
  tap-to-place + registry/catalog/library), and an insider two-player e2e at 360px.

**Out:** an AI opponent; a move timer / clock; move history / undo; spectators-only view specifics;
Checkers and Chess themselves (they follow, reusing this harness); a full public launch.

## Approach

Reversi uses the **LIVE model** proven by Teeter Tower (spec 0044), but its state is fully
serializable, so the whole game lives in **scratch** and there is no in-process world:

- **Board harness (`board.ts`), the reusable core.** A `Grid<T>` is an immutable-friendly square board
  stored row-major that round-trips through scratch as `{ size, cells }`. Coordinate helpers bounds-
  check and the `ALL_DIRECTIONS` list gives the eight compass `Step`s that both Reversi's flips and a
  future rook/bishop/queen slide walk. `Turns` maps the two engine players to seat 0 (Violet, moves
  first) and seat 1 (Amber) by roster order and tracks whose turn it is; `assignSeats` builds it at
  configure. Nothing here knows about discs.
- **Rules (`rules.ts`), pure Reversi.** `startingBoard` places the four center discs. `flipsFor`
  walks each of the eight rays from a candidate square: it steps over an unbroken run of opponent
  discs and, only if that run terminates on one of the mover's own discs, brackets the whole run.
  `legalMoves` / `hasLegalMove` build on it; `applyMove` places the disc and flips every bracketed
  run; `isGameOver` is "neither side has a legal move"; `winnerOf` is the disc-count majority (a tie
  is a draw). These are pure and exhaustively unit-tested (each direction, multi-direction, the
  illegal cases, the forced pass, and end/scoring).
- **Module (`reversi.ts`), the LIVE wiring.** `configure` assigns seats and the opening into scratch.
  `collectMove` accepts a placement only from the seat to move and only on a legal square (else it
  returns `{ rejected: { reason } }` so the engine replies to that device alone), applies the flips,
  then resolves the next turn: if the next side has a legal move it takes the turn; if not but the
  other does, the turn passes back (flagged); if neither can move, the game is over. `tick` streams
  the current board (there is no world to step) and reports `over`. Standings rank each seat's player
  by their color's final disc count. There is **no `disposeLive`** - nothing to release.
- **Web (`apps/web/lib/games/reversi`).** The single-surface Viewer draws the streamed board on one
  canvas and, on the local turn, hit-tests a tap to a cell and submits it. The layout math + tap
  mapping + theme-token chrome live in a reusable `board-render.ts` (the pattern Checkers/Chess
  follow); the disc colors come from the canopy grape (Violet) and sunbeam (Amber) tokens - no
  hardcoded brand hex - on a wood-grain board. The scoreboard + turn state render as DOM rows (a
  screen-reader status mirror and a stable test signal). Mobile-first: the board fits width as a
  square, reads at ~360px, uses whole-cell tap targets and `touch-action: none`.

## Acceptance

1. **Opening + turn.** From `configure`, the board is the standard opening (violet at (3,4)/(4,3),
   amber at (3,3)/(4,4)); Violet (the first player) moves first and has exactly four legal opening
   moves. *(engine unit tests: `configure`, `startRound`, `legalMoves`)*
2. **Flip/bracket in all eight directions.** A placement that brackets an opponent run terminated by
   the mover's own disc flips the whole run, in each of the eight directions and across multiple
   directions at once; a placement that brackets nothing (occupied, adjacent-own-only, off-board, or
   gapped) is illegal. *(engine unit tests: `flipsFor` per direction + illegal cases)*
3. **Apply.** Applying a legal move places the disc and flips every bracketed disc; disc counts update
   accordingly. *(engine unit test: `applyMove`, `scoreOf`)*
4. **Forced pass.** When the side to move has no legal move but the other does, the turn is passed
   (skipped) and flagged; the game does not end. *(engine unit tests: `hasLegalMove`, module forced
   pass)*
5. **End + scoring.** When neither side can move, the game is over; the winner is the disc-count
   majority (a tie is a draw); standings rank the two players by their final disc count. *(engine unit
   tests: `isGameOver`, `winnerOf`, module standings/draw)*
6. **Turn + legality enforcement.** `collectMove` rejects an out-of-turn move, an illegal placement,
   and a malformed move, each `{ rejected: { reason } }` (engine replies to that device only); it
   accepts and applies a legal move. *(engine unit tests: `collectMove`)*
7. **Perfect information.** The sim is broadcast with the whole board; no per-player private payload is
   used. *(the module returns no `private`; the sim carries the full board)*
8. **Web renderer + tap-to-place.** The Viewer decodes the sim, draws the board, highlights the active
   player's legal squares, and emits `onMove({row,col})` only for a legal tap on the local turn
   (ignoring illegal / out-of-turn taps); it shows the scoreboard, whose turn it is, a forced pass,
   and the winner in the DOM. *(web component tests: `board-render`, `protocol`, `Viewer`)*
9. **Insider gating + registration.** Reversi is registered in the engine (both lists) and the web
   registry, has a marketing catalog + library entry, and is `visibility: 'insider'` everywhere; a
   non-insider (and an insider on the apex surface) never sees it. *(web `index` test; e2e gate tests)*
10. **Brand mark.** The Reversi mark is a two-tone disc/board motif carrying the single gold root
    `#d2a463`. *(brand test)*
11. **End-to-end (360px).** Two insiders join one room on the insider surface, start the game, and the
    first player taps a legal opening square; the engine applies the flip and streams the new board
    (disc counts change, the turn passes) - all at a 360px viewport. *(e2e `reversi.spec.ts`; runs in
    CI - see notes if docker cannot run in the sandbox)*
