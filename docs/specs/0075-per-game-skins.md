# 0075 - Per-game colour skins

## Problem

Every game renders on the one global Confetti palette (grape primary, bubblegum secondary, sunbeam
accent, on the dark stone ground). A game's only distinct colour is its SVG mark and hero art; the
moment you are in-game, Trivia, Liar Liar, Lone Leaf, Reversi, and Checkers all look identical. The
operator wants each game to feel visually its own - a warm game-show Trivia, an opulent Liar Liar, a
calm Lone Leaf, a felt-green Reversi, a classic-red Checkers - without scattering colour overrides
through the game components, and without a second parallel colour system to maintain.

## Outcome

- A game declares a small colour `skin` in its `GameUiModule`. The shell (`GameStage`) maps it onto
  the semantic `--color-*` custom properties for the in-game subtree, so canopy components and the
  game surfaces re-colour with no per-component edits. This is the exact mechanism the `.dark` class
  uses, scoped to a game instead of the document.
- Five games ship a skin: Trivia (Marquee Gold), Liar Liar (Masquerade), Lone Leaf (Forest Floor),
  Reversi (Emerald Parlour), Checkers (Classic Red). Games without a skin are unchanged.
- Liar Liar's mark is redrawn as a Venetian cat-eye mask; the five games' marks and hero art are
  recoloured to their new palettes.
- Status colours (success / warning / danger / info) stay on the global palette in every game, so a
  green "correct", an amber "paused", and a red error keep their meaning.

## How it works

`skinToVars(skin)` (`apps/web/lib/games/skin.ts`) expands ten brand inputs into the ~two dozen
semantic `--color-*` roles it owns (grounds, text, borders, primary / secondary / accent and their
foregrounds), returning a `CSSProperties` var map. `GameStage` reads `ui.skin`, spreads the vars onto
the stage's outer `<div>` (with a `data-game-skin` marker), and every descendant that renders through
the semantic Tailwind utilities re-colours by cascade. Because custom properties inherit and a rule on
the element beats the inherited `.dark` value, the skin overrides the global palette for that subtree
with no specificity fight and no `!important`.

The canvas board games (Reversi, Checkers) are the one surface that reads PRIMITIVE tokens rather than
semantic roles: `board-render.ts` reads `--color-honey-*` (square tints), `--color-grape-*` /
`--color-sunbeam-*` (the two sides), and `--color-honey-300` (king crown) off the board element's
computed style. The skin's optional `vars` escape hatch re-points exactly those primitives for the
board games, so the felt / squares / discs / pieces match the rest of the skin. The board element sits
inside the skinned subtree, so it reads the overridden values via `getComputedStyle`.

Portalled overlays (canopy Dialog / Sheet / Toast) mount at `<body>`, outside the stage subtree, so
the inline vars do not reach them. `GameStage` also mirrors the skin onto the document root
(`document.documentElement.style`) in an effect while a skinned game is mounted, and removes it on exit
or game change. The room route carries no global nav of its own, so tinting the document root only
skins the room (its header and any portalled overlays) and reverts cleanly to the global palette for
the lobby and the rest of the app. The inline style on the stage `<div>` stays too, so the in-flow
surfaces are skinned from first paint with no SSR flash before the effect runs.

## Non-goals / follow-ups

- Only the five reviewed games are skinned; the other nine keep the global palette. Extending the set
  is adding a `skin` to each module.
- Reversi / Checkers still label the two sides "Violet" / "Amber" (the engine's internal names); with
  the recoloured discs those labels read slightly off. Renaming the side labels is a separate copy
  change owned by the engine, out of scope here.
- Hero art is recoloured; Liar Liar's hero keeps its existing mask composition (recoloured), while its
  mark is the new Venetian mask. Unifying the hero to the new mask is a follow-up.

## Tests

- Type + lint + build pass with the new module field and shell wiring.
- The five game Viewers/Remotes use only semantic tokens (audited: no hardcoded hex, no primitive
  utility classes), so the skin reaches them; the board canvases are covered by the `vars` override.
- Verified in the running app: `/games` renders the recoloured marks and heroes; the real Viewers /
  Remotes (including the canvas boards) re-colour correctly under each skin.
