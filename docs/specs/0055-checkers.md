# 0055 - Checkers: classic draughts board game (insider-only), on the reusable board harness

## Problem

We are bringing real, two-player abstract board games to the platform. Reversi (spec 0054) shipped the
**first** board game and, with it, a reusable **board harness** (the shared `@branchout/game-board`
package: a serializable `Grid`, coordinate + direction rays, two-seat turn management) plus a shared web
board-renderer geometry. **Checkers** (classic English draughts) is the **second** board game: it proves
the harness generalizes by reusing it wholesale and adding only Checkers-specific rules and piece
chrome. Like Reversi it ships behind the existing insider surface (spec 0043), so it stays off the
public catalog until it is ready.

Checkers is a **perfect-information** game: the whole board is public, so it does NOT need the
per-player private channel (spec 0052). Its state is fully serializable board logic - no in-process
world (no Matter.js), so, like Reversi, there is no `disposeLive`.

## Outcome

- Two insiders can create a room, pick **Checkers** (visible only on the insider surface), and play a
  full game on **one shared board**: Violet (the first player) and Amber alternate moving; a man moves
  one square diagonally forward, or **jumps** an adjacent opponent into the empty square beyond to
  capture it; jumps **chain** (a landed piece that can jump again must keep jumping - a multi-jump);
  **mandatory capture** applies (if any jump is available that turn, a plain step is illegal); a man
  that stops on the far row is crowned a **King** that moves and jumps in all four diagonal directions;
  the game ends when the side to move has **no legal move** (no pieces, or all blocked) and that side
  loses.
- The board is **server-authoritative**: the engine holds the board, turn, and over-state in scratch
  and streams the whole board on the `sim` frame whenever it changes. The browser is a pure **renderer
  + input surface**: it draws the streamed board and, on the local player's turn, uses a
  **select-then-move** two-tap flow (tap a movable piece, then a highlighted destination) to submit a
  `{from, path}` move - the full jump path is read from the streamed legal list, so a multi-jump is
  submitted whole. An illegal or out-of-turn tap is rejected by the engine **to that one device**.
- Interactive play is **one canvas that is itself the controller** (`singleSurface: true`): the shell
  renders only the Viewer and passes `onMove` through; there is no separate Remote.
- The presentation is themed to Branch Out: **Violet vs Amber** acorn pieces (canopy grape/sunbeam
  tokens, no hardcoded brand hex) on a **wood-grain** board, with a gold-root crown ring marking a
  King. The game keeps its generic name Checkers; no trademarked branding is referenced.
- Checkers reuses the shared `@branchout/game-board` harness and the shared web board geometry that
  Reversi established - it depends on **those**, never on the Reversi package - and keeps its piece
  chrome (colors, the King crown) out of the shared renderer.
- The game is absent from the public game picker, public game pages, and the sitemap; a non-insider
  cannot see or start it, and an insider on the apex surface does not see it either.

## Scope

**In:**

- A new engine game plugin `packages/games/checkers` (LIVE model) with:
  - **pure rules** (`rules.ts`): the opening (12 men per side on the dark squares of three home rows),
    forward man moves + king four-way moves, single jumps and full multi-jump chains, mandatory
    capture, crowning (including the crown-stops-the-chain rule), end detection, and piece-count
    scoring;
  - the LIVE module (`checkers.ts`): board + turn + over-state in scratch, `collectMove` validating a
    move (turn + full legality incl. mandatory capture and the whole multi-jump path, rejecting
    illegal/out-of-turn to the device), `tick` streaming the board on change, `over` when the side to
    move is stuck, and custom 2-player standings ranking the winner first;
  - the wire contract (`types.ts`): a `WireCell` (flattened piece code) sim + a `{from, path}` move.
- Registration in the game engine (`index.ts` + `worker/game-worker.ts`, kept in sync) and its
  dependency.
- The web UI module `apps/web/lib/games/checkers` (`singleSurface`): a protocol decoder, Checkers's own
  board chrome (`board-render.ts`, reusing the shared `../board/geometry`), the select-then-move
  Viewer, a null Remote, and a no-config ConfigPanel; registry + marketing catalog + library entries.
- A brand mark (`packages/brand/src/checkers.ts` + the `./checkers` export + tsup entry): an oak
  skeleton bent to a two-tone acorn/board motif with a crowned King, carrying the single gold root
  `#d2a463`.
- Tests: deterministic engine unit tests (rules + module), web component tests (decoder +
  select-then-move Viewer + registry/catalog/library), and an insider two-player e2e at 360px.

**Out:** an AI opponent; a move timer / clock; move history / undo; draw offers / repetition /
50-move rules (this variant has no draw - a side with no move loses); the "must take the longest jump"
majority rule (any available jump is legal); Chess (it follows, reusing this same harness); a full
public launch.

## Approach

Checkers uses the **LIVE model** proven by Teeter Tower (spec 0044) and Reversi (spec 0054), but its
state is fully serializable, so the whole game lives in **scratch** and there is no in-process world.

- **Harness reuse.** Checkers imports the shared `@branchout/game-board` package for `Grid<T>`, the
  `DIAGONAL` rays, and `Turns`/`assignSeats`, and the shared web `../board/geometry` for layout +
  hit-test - the exact primitives Reversi factored out. Nothing Checkers-specific leaks into those
  shared modules; the piece colors + King crown live in Checkers's own `board-render.ts`.
- **Rules (`rules.ts`), pure Checkers.** A cell is a `Piece {seat, king}` or null. `startingBoard`
  places 12 men per side on the dark squares of rows 0-2 (Amber) and 5-7 (Violet). A man's forward
  diagonals depend on its side (Violet up, Amber down); a king uses all four. `captureHopsFrom` finds
  single jumps; `jumpPathsFrom` walks the jump tree over a candidate board to enumerate only **maximal**
  chains (so a partial jump is never a legal stop), crowning-mid-chain ends a chain. `legalMoves`
  applies **mandatory capture** (if any jump exists, only jumps are returned). `applyMove` edits the
  board (moving, removing every jumped piece, crowning on the crown row). `hasLegalMove` drives end
  detection; the side to move with no legal move has lost (no draw).
- **Module (`checkers.ts`), the LIVE wiring.** `configure` assigns seats and the opening into scratch.
  `collectMove` accepts a move only from the seat to move and only when it is one of that seat's legal
  moves (this single check enforces mandatory capture and the full multi-jump path); else it returns
  `{ rejected: { reason } }` so the engine replies to that device alone. It applies the move, flips the
  turn, and marks `over` if the new side to move is stuck. `tick` streams the current board (there is
  no world to step) and reports `over`. Standings give the winner a large bonus over the loser so the
  winner ranks first even when the loser has more pieces (a stuck-but-not-captured-out loss); the
  reported score is the surviving piece count. There is **no `disposeLive`**.
- **Web (`apps/web/lib/games/checkers`).** The single-surface Viewer draws the streamed board on one
  canvas. Because a checkers move needs a source + a destination, interaction is a **two-tap
  select-then-move**: the first tap selects a movable own piece (its legal destinations highlight), the
  second tap on a destination submits the full `{from, path}` (the whole jump path looked up from the
  streamed legal list). The piece colors come from the canopy grape (Violet) and sunbeam (Amber)
  tokens - no hardcoded brand hex - on a wood-grain board; a King wears a gold-root crown ring. The
  scoreboard + turn state render as DOM rows (a screen-reader status mirror and a stable test signal).
  Mobile-first: the board fits width as a square, reads at ~360px, uses whole-cell tap targets and
  `touch-action: none`.

## Rule variant (documented)

This game ships **standard English draughts** with these choices made explicit:

- **Mandatory capture is ON.** If the side to move has any capture available, a plain (non-capturing)
  move is illegal that turn. Among available captures the player may choose any (we do **not** enforce
  the "must take the longest / most-capturing jump" majority rule) - any jump, played to the end of its
  chain, is legal.
- **Multi-jumps are forced to completion.** A jumping piece that can jump again must continue; a partial
  jump is not a legal move.
- **Crowning stops the chain.** A man that reaches its crown row mid-jump is crowned and its turn ends
  immediately (it does not continue jumping as a fresh king that same turn).
- **No draw.** There is no draw offer / repetition / 50-move rule; a side with no legal move on its turn
  loses.

## Acceptance

1. **Opening + turn.** From `configure`, the board is the standard opening (12 men per side on the dark
   squares of rows 0-2 for Amber and 5-7 for Violet); Violet (the first player) moves first and has only
   plain man-step moves (no jumps yet). _(engine unit tests: `configure`, `startRound`, `legalMoves`)_
2. **Man moves + directions.** A man steps one square diagonally forward only (Violet up, Amber down); a
   king moves in all four diagonal directions. _(engine unit tests: `stepMovesFrom`, `stepsFor`,
   `forwardSteps`)_
3. **Captures + multi-jump.** A man jumps an adjacent opponent into the empty square beyond, removing it;
   a chain of jumps is enumerated as one maximal path, and a partial jump is not legal. A man cannot jump
   backward but a king can. _(engine unit tests: `captureHopsFrom`, `jumpPathsFrom`, illegal-partial)_
4. **Mandatory capture.** When any capture exists, `legalMoves` returns only captures (a plain step is
   filtered out and rejected by the module). _(engine unit tests: `legalMoves`, module rejection)_
5. **Crowning.** A man that stops on its crown row becomes a king; a mid-chain crown ends the turn.
   _(engine unit tests: `applyMove` crowning, `jumpPathsFrom` crown-stop; module crowning)_
6. **End + scoring.** The game is over when the side to move has no legal move (no pieces or all
   blocked); that side loses (no draw); standings rank the winner first even when the loser has more
   pieces. This is reached through a **real** capturing move, not an injected flag. _(engine unit tests:
   `isGameOverFor`, `winnerOf`, module over-through-move + standings)_
7. **Turn + legality enforcement.** `collectMove` rejects an out-of-turn move, an illegal move, a
   mandatory-capture-violating step, a partial multi-jump, and a malformed move, each
   `{ rejected: { reason } }` (engine replies to that device only); it accepts and applies a legal move.
   _(engine unit tests: `collectMove`)_
8. **Perfect information.** The sim is broadcast with the whole board; no per-player private payload is
   used. _(the module returns no `private`; the sim carries the full board)_
9. **Web renderer + select-then-move.** The Viewer decodes the sim, draws the board (men + crowned
   kings), highlights movable sources and a selected piece's destinations, and emits `onMove({from,
   path})` only after a select-then-destination tap on the local turn (submitting the full jump path);
   it shows the scoreboard, whose turn it is, and the winner in the DOM. _(web component tests:
   `protocol`, `Viewer`)_
10. **Insider gating + registration.** Checkers is registered in the engine (both lists) and the web
    registry, has a marketing catalog + library entry, and is `visibility: 'insider'` everywhere; a
    non-insider (and an insider on the apex surface) never sees it. _(web `index` test; e2e gate tests)_
11. **Brand mark.** The Checkers mark is a two-tone acorn/board motif with a crowned King, carrying the
    single gold root `#d2a463`. _(brand test)_
12. **End-to-end (360px).** Two insiders join one room on the insider surface, start the game, and play a
    real ALTERNATING sequence of moves - including at least one capture that changes the piece counts -
    with the moves streaming back to both devices; all at a 360px viewport. _(e2e `checkers.spec.ts`;
    runs in CI - see notes if docker cannot run in the sandbox)_
