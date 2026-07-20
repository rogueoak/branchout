# 0071 - Checkers: animations, turn popups, see-moves toggle, and promote to public

## Problem

Checkers (spec 0055) shipped `visibility: 'insider'` so it could bake behind the insider gate. It
never got the polish Reversi received (spec 0070 / WS9): the pieces snap between board snapshots with
no motion, there is no turn-start cue, and the host cannot dial back the legal-move hints for a
tougher game. It also drifted from the family in one quiet way - Checkers is absent from
`PLAYER_LIMITS`, so the web layer falls back to the permissive 1-8 default even though the engine
plugin enforces a strict 2. The operator wants Checkers brought up to the Reversi bar and moved onto
the main site: animated moves/captures/crownings, a turn popup, a "See available moves" advanced
toggle (default on), a correct two-player cap, and a public promotion with a 600x800 portrait hero.
This is WS14.

## Outcome

- Checkers pieces ANIMATE the authoritative board deltas between sims: a moved piece SLIDES from its
  source to its landing square, captured (jumped) pieces FADE out, and a man that reaches the far row
  CROWNS with a gold ring that scales in. Driven off a pure `diffMove(prev, next)` diff, exactly like
  Reversi's `detectFlips`. `prefers-reduced-motion` renders instantly (no animation).
- A brief on-board turn-start popup ("Your turn", or "Your turn - you must jump" when a capture is
  forced) appears ~1.8s then fades, `aria-hidden`, with the existing `aria-live` status line doing
  the announcing. Driven by a pure `turnPopupMessage` keyed on the board state.
- A "See available moves" advanced toggle (default ON) gates the movable-source rings and destination
  hint dots, rendered through the game module's `AdvancedConfigPanel` in the lobby's collapsed
  "Advanced settings" accordion (spec 0068). With hints off, the interactive copy stops referencing
  "highlighted" squares.
- `PLAYER_LIMITS.checkers` is a strict `{ min: 2, max: 2 }`, matching the plugin capabilities; a
  cross-check test guards the two sources from drift.
- Checkers is `visibility: 'public'` in BOTH the web module and the engine plugin manifest. It then
  surfaces on the public picker, `/games`, its feature page, the sitemap, and the home hero carousel
  (now four public games). It ships a 600x800 portrait hero (`assets/hero-checkers-portrait.svg`).

## Scope

In:

- `packages/games/checkers/src/checkers.ts`: add `showAvailableMoves` to the config, scratch, and
  streamed sim; flip the manifest `visibility` to `'public'`.
- `apps/web/lib/games/checkers/`: `protocol.ts` (decode `showAvailableMoves`), `config.ts` +
  `AdvancedConfigPanel.tsx` (the toggle), `turn-notice.ts` (`diffMove`, `turnPopupMessage`,
  `hasMandatoryCapture`, `hintsVisibleFor`), `Viewer.tsx` (canvas slide/capture/crown animation,
  turn popup, hint gating + copy branching), `index.ts` (register the panel, default config,
  `visibility: 'public'`).
- `packages/protocol/src/games.ts`: add `checkers: { min: 2, max: 2 }`; add a checkers
  player-limits cross-check test.
- Brand: `assets/hero-checkers-portrait.svg` (600x800), `packages/brand/src/hero-portrait-checkers.ts`,
  tsup entry, package.json export, brand portrait-hero test.
- `apps/web/lib/games/heroes-portrait.ts`: map `checkers`.
- `apps/web/lib/games/catalog.ts`: Checkers badge `Insider` -> `New`, drop "insider testing" copy.
- Tests: web `index.test.ts`, `Viewer.test.tsx`, new `AdvancedConfigPanel.test.tsx` and
  `turn-notice.test.ts`; the checkers e2e moves to the PUBLIC room-create flow; sitemap adds
  `/games/checkers`.

Out:

- A dedicated `/share-checkers.png` Open Graph raster (Checkers reuses the Trivia share card, as it
  did while insider; a per-game raster is a separate follow-up).
- Any change to the Checkers rules or the engine's move legality.

## Approach

Reuse the Reversi WS8/WS9 pattern verbatim so the two board games stay one family. The animation is a
canvas rAF loop reading a single in-flight `MoveAnim` object (one move at a time; a new snapshot
replaces it), computed by a pure `diffMove` that classifies the removed squares by color - the square
matching the mover's color is the SOURCE, the opposite-color removed squares are CAPTURES - and reads
the crown off the landing cell. Visibility is the single source of truth (`isPublicGame`), so flipping
the one field plus adding the portrait art does the promotion; the catalog portrait-coverage test
fails loudly if a public game lacks its 600x800 portrait.

## Acceptance

- [ ] `diffMove` classifies slide, captures, and crown from two board snapshots (unit-tested).
- [ ] `turnPopupMessage` returns "Your turn" / the must-jump variant for the active player, null
      otherwise (unit-tested).
- [ ] The "See available moves" toggle defaults ON, gates the hints, and drops "highlighted" copy
      when off.
- [ ] `PLAYER_LIMITS.checkers` and the plugin capabilities both read `{2, 2}` and a test cross-checks
      them.
- [ ] `checkersGameUi.visibility === 'public'`; the engine manifest matches; `PUBLIC_GAME_CATALOG`
      includes `checkers`; its badge is `New`.
- [ ] `assets/hero-checkers-portrait.svg` is 600x800, on-brand, keeps the gold root, embeds no fonts;
      brand exports it and the portrait-hero test covers it.
- [ ] The Checkers e2e creates and plays Checkers through the PUBLIC flow.
- [ ] Tests, lint, `@branchout/web` build, the checkers + protocol package builds/tests,
      `@branchout/e2e` typecheck, and `pnpm format:check` all pass.
</content>
</invoke>
