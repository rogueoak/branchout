# 0073 - Promote Lone Leaf to the public site (+ featured carousel curation)

## Problem

Lone Leaf (spec 0057) shipped `visibility: 'insider'` so it could bake behind the insider gate while
its recent work landed (difficulty by word obscurity, the three proper-noun themes, the trivia-style
prompt card, remote reveal). That work is merged and the operator wants Lone Leaf on the main site.

At the same time the home hero carousel (spec 0067) shows EVERY public game. The public roster has
grown to Trivia, Liar Liar, Reversi, and Checkers (specs 0070, 0071), so adding Lone Leaf would make a
five-card filmstrip - the hero stops being a spotlight. The operator wants the two board games
(Reversi, Checkers) demoted from the carousel while staying fully public and playable, and Lone Leaf
promoted INTO the carousel. That needs a curated "featured" concept the carousel filters on, distinct
from "public".

## Outcome

- Lone Leaf is public (its plugin manifest and web module drop `visibility: 'insider'`, defaulting to
  public like Trivia and Liar Liar). It surfaces automatically on the public game picker, the `/games`
  index, its `/games/lone-leaf` feature page, and the sitemap. Its marketing copy drops the "insider
  testing" / "Still in testing" framing and its badge becomes `New`.
- A new FEATURED concept curates the carousel: a `featured` flag on the marketing catalog entry, and a
  derived `FEATURED_GAME_CATALOG`. The home hero carousel is built from the featured subset, not every
  public game. Featured today: Trivia, Liar Liar, Lone Leaf. Reversi and Checkers are public-but-not-
  featured, so they stay on `/games` and keep their feature pages but no longer ride the carousel.
- The home carousel shows three portrait cards (Trivia, Liar Liar, Lone Leaf) and peeks a slide on
  both sides at a 360px phone width; `/games` still lists all five public games.
- Lone Leaf ships a 3:4 PORTRAIT hero (`assets/hero-loneleaf-portrait.svg`, 600x800) so the carousel's
  aspect-[3/4] slide renders real art. The catalog portrait-coverage test (every public game resolves
  a 600x800 portrait) stays green.

## Scope

In:

- Flip the Lone Leaf plugin manifest (`packages/games/lone-leaf`) and web module
  (`apps/web/lib/games/lone-leaf`) visibility to public.
- Author `assets/hero-loneleaf-portrait.svg`: the single-leaf motif recomposed upright in the upper
  ~60% (reusing the exact mark geometry inside a `translate/scale` wrap), the family radial tile
  (green `#1c2b1e` -> `#0d0a15`), the green glow, the single gold root node, and a system-font wordmark
  + one-line tagline centered near the base. No embedded fonts.
- Wire the brand portrait export (`hero-portrait-loneleaf.ts`, the tsup entry, the package.json
  export) exactly like Trivia/Liar Liar/Reversi/Checkers; add `lone-leaf` to the web portrait map.
- Refresh the Lone Leaf marketing badge (`Insider` -> `New`) and drop the "insider testing" phrasing.
- Introduce the featured concept: a `featured` flag in the marketing catalog, a derived
  `FEATURED_GAME_CATALOG`, and switch the landing carousel to source it. Mark Trivia, Liar Liar, and
  Lone Leaf featured.
- Update the unit tests that used Lone Leaf as the insider exemplar (catalog, sitemap, feature-page
  surface gating) to a still-insider game (Teeter Tower), and add Lone Leaf public/featured coverage.
  Update the carousel e2e (featured count is 3; Reversi/Checkers absent from the carousel, present on
  `/games`).

Out:

- A dedicated `/share-loneleaf.png` Open Graph raster (Lone Leaf still reuses the Trivia share card,
  as it did while insider, and as Reversi/Checkers still do; a per-game share raster is a follow-up).
- Any change to Lone Leaf gameplay, rules, or the engine.
- Reversi/Checkers stay public - this only removes them from the carousel, nothing else.

## Approach

Visibility is the single source of truth for public/insider: `isPublicGame` already keys every public
surface off it, so dropping the one field does the promotion. Featured is a SEPARATE, additive axis: a
game is public (on `/games`, has a feature page) OR insider; and independently featured (leads the
carousel) or not. `FEATURED_GAME_CATALOG = PUBLIC_GAME_CATALOG.filter(e => e.featured)` keeps the
invariant that only a public game can be featured. The carousel reads the featured list; the teaser
grid and `/games` keep reading the full public list. The portrait art is the only new asset, because
the carousel force-fits each slide into a 3:4 box and the coverage test fails loudly if a public game
lacks a 600x800 portrait; it reuses the mark geometry inside a `translate/scale` wrap so it stays on-
brand, then stacks the wordmark and tagline at the base like the other portraits.

## Acceptance

- [ ] Lone Leaf plugin manifest and web module are public (`isPublicGame` true); `PUBLIC_GAME_CATALOG`
      includes `lone-leaf`; `/games/lone-leaf` renders publicly and is in the sitemap.
- [ ] `assets/hero-loneleaf-portrait.svg` is 600x800, on-brand, keeps the gold root, embeds no fonts,
      and renders a clean phone card; brand exports it (module + tsup entry + package.json export) and
      `@branchout/brand` builds + tests green.
- [ ] `heroes-portrait.ts` maps `lone-leaf`; the catalog portrait-coverage test passes with Lone Leaf
      public.
- [ ] `FEATURED_GAME_CATALOG` is `[trivia, liar-liar, lone-leaf]`; the carousel shows exactly those
      three and excludes Reversi + Checkers, which remain on `/games`.
- [ ] Insider-exemplar unit tests moved off Lone Leaf; new Lone Leaf public/featured coverage added.
      The carousel e2e asserts the featured set at 360px.
- [ ] Tests, lint, typecheck, `@branchout/web` build, and `prettier --check` all pass.
