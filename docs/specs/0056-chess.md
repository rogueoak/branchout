# 0056 - Chess: classic two-player chess (insider-only)

## Problem

We want the correctness-heaviest abstract board game on the platform: **Chess**. Reversi (spec 0054)
established the reusable **board harness** - turn management, a serializable `Grid`, board-in-scratch,
and a single-surface board renderer - and Checkers reused it. Chess reuses the same harness, but its
rules are far heavier: **full legal-move generation** for six piece types, the special moves (castling,
en passant, promotion), and **check / checkmate / stalemate** detection, with the rule that a move is
illegal if it leaves the mover's own king in check. This is the game where a rules bug is a silent
correctness regression, so the rules ship with an exhaustive deterministic test suite.

Chess is a **perfect-information** game: the whole position is public, so it does NOT need the
per-player private channel (spec 0052). Its state is fully serializable (a FEN-like position - board,
side to move, castling rights, en-passant target, and the two move counters), so like Reversi it holds
**no in-process world** (no Matter.js) and has no `disposeLive`. It ships behind the existing insider
surface (spec 0043) until it graduates.

## Outcome

- Two insiders can create a room, pick **Chess** (visible only on the insider surface), and play a
  full game on **one shared board**: Violet (White, the first player) and Amber (Black) alternate
  moves; every standard rule applies - all six pieces move their own way, castling (both sides, with
  the legality conditions), en passant (the one-move capture window), and pawn promotion; a move is
  **illegal if it leaves the mover's own king in check**; the game ends on **checkmate** (the mated
  side loses), **stalemate** (a draw), or **draw by insufficient material**, and either side may
  **resign**.
- The board is **server-authoritative**: the engine holds the position in scratch and streams the
  whole position on the `sim` frame whenever it changes. The browser is a pure **renderer + input
  surface**: it draws the streamed position and, on the local player's turn, uses a two-tap move (tap a
  piece, then a highlighted destination), with a promotion picker and a resign button. An illegal or
  out-of-turn move is rejected by the engine **to that one device** (never a broadcast).
- Interactive play is **one canvas that is itself the controller** (`singleSurface: true`): the shell
  renders only the Viewer and passes `onMove` through; there is no separate Remote.
- The presentation is themed to Branch Out: **Violet (White) vs Amber (Black)** armies on a
  **wood-grain** board (canopy grape/sunbeam tokens, no hardcoded brand hex). The game keeps its
  generic name Chess; no trademarked branding is referenced.
- The board machinery is reused from `@branchout/game-board`; the chess-specific rules and piece chrome
  are the game's own, keeping piece drawing out of the shared renderer.
- The game is absent from the public game picker, public game pages, and the sitemap; a non-insider
  cannot see or start it, and an insider on the apex surface does not see it either.

## Scope

**In:**

- A new engine game plugin `packages/games/chess` (LIVE model) with:
  - **pure chess rules** (`rules.ts`): a FEN-like `Position`, per-piece pseudo-move generation,
    square-attack + check detection, the king-safety legal-move filter, castling (rights + the
    through/into/out-of-check + empty-path conditions), en passant (target setting + the capture, with
    the one-move window), promotion (all four choices), `applyMove` (with the special mechanics +
    castling-rights loss + move counters), and end detection (checkmate / stalemate / insufficient
    material);
  - the LIVE module (`chess.ts`): position in scratch, `collectMove` validating FULL legality (turn +
    the whole legal-move filter, rejecting illegal/out-of-turn to the device) and a `resign` move,
    `tick` streaming the position on change, `over` on mate/stalemate/draw/resign, and custom 2-player
    standings by result (win 2, draw 1, loss 0).
- Registration in the game engine (`index.ts` + `worker/game-worker.ts`, kept in sync) and its
  dependency.
- The web UI module `apps/web/lib/games/chess` (`singleSurface`): a protocol decoder, the Chess board
  chrome (`board-render.ts`: reuses the shared geometry, adds piece glyphs + chrome), the two-tap
  Viewer with a promotion picker + resign, a null Remote, and a no-config ConfigPanel; registry +
  marketing catalog + library entries.
- A brand mark (`packages/brand/src/chess.ts` + the `./chess` export + tsup entry): an oak skeleton
  bent to a crowned king carrying the single gold root `#d2a463`.
- Tests: exhaustive deterministic engine unit tests (per-piece movement, pins, castling legal + each
  illegal condition, en passant incl. the window, promotion, check, checkmate mate-in-one, stalemate,
  insufficient material, illegal-move rejection; module lifecycle + end transitions reached through a
  real move), web component tests (decoder + chrome + two-tap Viewer + promotion + registry/catalog/
  library), and an insider two-player e2e at 360px playing to a known checkmate.

**Out:** an AI opponent; a move clock / timer; move history / undo / PGN; a draw-offer / agreed draw;
**auto-claiming** threefold repetition or the fifty-move rule (the halfmove/fullmove counters are
tracked in the position but not auto-claimed - a documented future enhancement); a full public launch.

## Approach

Chess uses the **LIVE model** proven by Reversi (spec 0054); its state is fully serializable, so the
whole game lives in **scratch** and there is no in-process world.

- **Board harness (`@branchout/game-board`), reused as-is.** The `Grid<Cell>` holds the board (a cell
  is `'empty'` or a two-character `<color><type>` piece code, e.g. `'wP'`), round-tripping through
  scratch as `{ size, cells }`. `Turns` maps the two players to seat 0 (White, moves first) and seat 1
  (Black); `assignSeats` builds it at configure.
- **Rules (`rules.ts`), pure chess.** `pseudoMovesFrom` generates each piece's raw moves (pawns
  including the double push, diagonal captures, en passant, and promotion expansion; sliders by ray;
  knight/king by step; the king also castling with its attack-square conditions). `isSquareAttacked`
  is the attack primitive check detection and castling-safety are built on. `legalMovesFrom` applies
  the king-safety filter: a pseudo-move is legal only if, after `applyMove`, the mover's king is not in
  check - this is what makes a pinned piece illegal to move off its pin line, and forces check evasion.
  `applyMove` handles the special mechanics (castling rook shift, en-passant capture removal, promotion,
  en-passant target setting, castling-rights loss on king/rook move or rook capture) and the move
  counters. End detection: `isCheckmate` (in check + no legal move), `isStalemate` (not in check + no
  legal move), and `isInsufficientMaterial` (bare kings, K+minor, or same-colored K+B vs K+B).
- **Module (`chess.ts`), the LIVE wiring.** `configure` sets the opening into scratch. `collectMove`
  accepts a move only from the side to move and only if `isLegalMove` (the full filter) passes (else it
  returns `{ rejected: { reason } }` so the engine replies to that device alone), applies it, then
  resolves the end (checkmate -> the mover wins; stalemate / insufficient material -> a draw). A
  `resign` move concedes to the other side. `tick` streams the current position and reports `over`.
  Standings rank each player by the result (win 2, draw 1, loss 0). There is **no `disposeLive`**.
- **Web (`apps/web/lib/games/chess`).** The single-surface Viewer draws the streamed position on one
  canvas (pieces as Unicode chess glyphs tinted to the army color, on a wood-grain board) and, on the
  local turn, runs the two-tap move: tap a friendly piece to select it (its legal destinations from the
  sim's `legal` list light up), then tap a destination. A promoting move raises a Queen/Rook/Bishop/
  Knight picker; a Resign button concedes. The layout + tap hit-test come from the shared
  `../board/geometry`. The turn / check / result state renders as a DOM status row (a screen-reader
  mirror and a stable test signal). Mobile-first: the board fits width as a square, reads at ~360px,
  uses whole-cell tap targets and `touch-action: none`.

## Acceptance

1. **Per-piece movement.** Each piece generates its correct moves on an open board (knight's eight
   L-moves, bishop/rook/queen rays until blocked, king's steps, and pawn advance/double/capture).
   *(engine unit tests: `pseudoMovesFrom` / `legalMovesFrom` per piece)*
2. **Pins + check evasion.** An absolutely pinned piece cannot move off the pin line (a pinned rook may
   still move along it); when in check, only check-evading moves are legal. *(engine unit tests: pins,
   `isInCheck`, check evasion)*
3. **Castling.** Both castles are offered when rights are held and the path is clear, and applying one
   moves the king two squares and the rook to the far side; castling is illegal without the right, with
   an occupied path, or out of / through / into check. *(engine unit tests: castling legal + each
   illegal condition; rights loss on king/rook move)*
4. **En passant.** A double pawn push sets the en-passant target; the capture removes the passed pawn;
   it is legal only on the immediately following move (the one-move window) and never when it would
   expose the mover's king. *(engine unit tests: en passant)*
5. **Promotion.** A pawn reaching the last rank offers all four promotions; applying one replaces the
   pawn; a promotion and an underpromotion are distinct legal moves. *(engine unit tests: promotion)*
6. **Checkmate / stalemate / insufficient material.** A mate-in-one is detected as checkmate (the mated
   side loses); a no-legal-move-not-in-check position is a stalemate draw; bare kings / K+minor /
   same-colored K+B vs K+B are insufficient-material draws. *(engine unit tests: `isCheckmate`,
   `isStalemate`, `isInsufficientMaterial`, `resultOf`)*
7. **Illegal-move rejection + turn.** `collectMove` rejects an out-of-turn move, an illegal move
   (including one that leaves the mover in check), and a malformed move, each `{ rejected: { reason } }`
   (engine replies to that device only); it accepts and applies a legal move. The decisive end is
   reached through a real `collectMove`, not hand-set scratch. *(engine module tests)*
8. **Perfect information.** The sim is broadcast with the whole position; no per-player private payload
   is used. *(module test: no `private`; the sim carries the full board)*
9. **Web renderer + two-tap move.** The Viewer decodes the sim, draws the position, and on the local
   turn selects a piece then submits a legal destination (raising a promotion picker when needed and
   offering resign); it shows the turn, check, and result in the DOM. *(web component tests:
   `board-render`, `protocol`, `Viewer`)*
10. **Insider gating + registration.** Chess is registered in the engine (both lists) and the web
    registry, has a marketing catalog + library entry, and is `visibility: 'insider'` everywhere; a
    non-insider (and an insider on the apex surface) never sees it. *(web `index` test; e2e gate tests)*
11. **Brand mark.** The Chess mark is a crowned-king oak motif carrying the single gold root `#d2a463`.
    *(brand test)*
12. **End-to-end (360px).** Two insiders join one room on the insider surface, start the game, and play
    a real alternating sequence to a known checkmate (Scholar's Mate); the DOM shows the winner on both
    phones - all at a 360px viewport. *(e2e `chess.spec.ts`; runs in CI - see notes if docker cannot run
    in the sandbox)*

## Notes

- **Optional draw rules.** The halfmove clock (fifty-move rule) and the fullmove counter live in the
  position and update correctly, but neither the fifty-move rule nor threefold repetition is
  **auto-claimed** - the game does not end on them. This matches how casual play usually runs and keeps
  the terminal set to mate / stalemate / insufficient material / resign; auto-claim (and a draw offer)
  are a documented future enhancement.
