# 0070 - Promote Reversi to the public site

## Problem

Reversi (spec 0054) shipped `visibility: 'insider'` so it could bake behind the insider gate while
its recent feedback landed (flip animation, turn popups, the two-player cap, the see-available-moves
toggle). That work is merged and the operator wants Reversi on the main site: it should appear on the
public `/games` index, have a public feature page, and ride the home hero carousel (spec 0067)
alongside Trivia and Liar Liar. This is the WS9 promotion.

## Outcome

- Reversi is `visibility: 'public'`, so the gating helper moves it from `INSIDER_GAME_UI_LIST` into
  `PUBLIC_GAME_CATALOG`. It then surfaces automatically on the public game picker, the `/games`
  index, its `/games/reversi` feature page, the sitemap, and the home hero carousel.
- The home carousel shows three public games (Trivia, Liar Liar, Reversi) and peeks a slide on both
  sides at a 360px phone width; the `/games` index shows a Reversi card.
- Reversi ships a 3:4 PORTRAIT hero (`assets/hero-reversi-portrait.svg`, 600x800) so the carousel's
  aspect-[3/4] slide renders real art instead of a distorted wide hero. The catalog's
  portrait-coverage test (every public game resolves a 600x800 portrait) stays green.

## Scope

In:

- Flip `reversiGameUi.visibility` to `'public'`.
- Author `assets/hero-reversi-portrait.svg`: the disc-flip board motif recomposed upright in the
  upper ~60%, the family radial tile (`#221836` -> `#0d0a15`), the violet glow, the single gold root
  node, and a system-font wordmark + one-line tagline centered near the base. No embedded fonts.
- Wire the brand portrait export (`hero-portrait-reversi.ts`, the tsup entry, the package.json
  export, the brand portrait-hero test) exactly like Trivia/Liar Liar.
- Add `reversi` to the web portrait map (`heroes-portrait.ts`).
- Refresh the Reversi marketing badge (`Insider` -> `New`) and drop the "insider testing" phrasing
  from its SEO description now that it is public.
- Update the unit tests that asserted Reversi is insider (registry/catalog visibility) and the
  Reversi e2e, which now creates and plays Reversi through the PUBLIC room-create flow.

Out:

- A dedicated `/share-reversi.png` Open Graph raster (Reversi still reuses the Trivia share card, as
  it did while insider; a per-game share raster is a separate follow-up).
- Any change to Reversi gameplay, rules, or the engine.

## Approach

Visibility is the single source of truth: `isPublicGame` already keys every public surface off it, so
flipping the one field does the promotion. The portrait art is the only new asset the promotion
requires, because the carousel force-fits each slide into a 3:4 box and the catalog coverage test
fails loudly if a public game lacks a 600x800 portrait. The portrait reuses the exact board geometry
from the landscape hero (`assets/hero-reversi.svg`) inside a `translate/scale/rotate` wrap so it stays
on-brand, then stacks the wordmark and tagline at the base like the Trivia/Liar Liar portraits.

## Acceptance

- [ ] `reversiGameUi.visibility === 'public'`; `PUBLIC_GAME_CATALOG` includes `reversi`.
- [ ] `assets/hero-reversi-portrait.svg` is 600x800, on-brand, keeps the gold root, embeds no fonts,
      and rasterizes to a clean phone card.
- [ ] Brand exports the portrait (module + tsup entry + package.json export) and the brand
      portrait-hero test covers it; `@branchout/brand` builds and tests green.
- [ ] `heroes-portrait.ts` maps `reversi` to the portrait; the catalog portrait-coverage test passes
      with Reversi public.
- [ ] The Reversi e2e creates and plays Reversi through the PUBLIC flow, and a normal account sees
      Reversi in the public picker and on the `/games` index.
- [ ] Tests, lint, `@branchout/web` build, `@branchout/e2e` typecheck, and `pnpm format:check` all
      pass.
