# 0018 - Open Graph share cards and per-game logos

## Problem

When someone pastes a Branch Out link into iMessage, WhatsApp, Slack, Discord, or a social
feed, the unfurl is the same generic card everywhere: the app icon centered on a dark canvas
(`apps/web/public/og.png`). Two things are missing:

1. The **home page** card should sell the product - the wordmark lockup and the tagline
   "where game night grows" - not just the bare icon.
2. A **share link** (`/join?code=XXXX`) should read as an invitation: "Join my game" over the
   art of the game being played, with a small Branch Out mark so the family brand is present.

Neither is possible today because there is no per-game art and no per-surface OG wiring. We also
want on-theme logos for the games themselves - **Trivia** (live today) and **Liar Liar** (a new
Fibbage-style bluffing game, logo only for now) - that follow the rogueoak/Confetti family rules
so game cards, share unfurls, and future game menus share one visual language.

## Outcome

- Two new game marks - `game-trivia.svg` and `game-liarliar.svg` - live in `assets/`, follow the
  brand rules (dark tile, radial glow, two-pass spark strokes `#FBBF24 -> #EC4899 -> #7C3AED`,
  party-color leaf nodes, the single gold root `#d2a463`), and are exported from
  `packages/brand`.
- The home page unfurls with a card built around the **wordmark + tagline**, not the bare icon.
- A share link unfurls with a **per-game "Join my game" card**: the game's title art as the
  backdrop, "Join my game" as the overlaid headline, and a small Branch Out mark in the top-left.
  When the room has not picked a game yet (or the game is unknown), it falls back to a generic
  Branch Out "Join my game" card.
- The join page resolves the room's selected game **server-side, without a session** (crawlers
  have no cookie and are not room members), via a new public room-preview endpoint.
- Happy path and the fallback are covered by tests, per the repo's e2e non-negotiable.

## Scope

In:

- `assets/game-trivia.svg`, `assets/game-liarliar.svg` - 512x512 game marks in the family style.
  - Trivia: the node-graph branch bent into a question mark, gold root at the base.
  - Liar Liar: a masquerade/domino mask built from the branch-node motif, one "false" node
    offset to hint at the lie; gold root anchors it. (Fibbage-style bluffing game.)
- `packages/brand`:
  - Export `triviaSvg` and `liarLiarSvg` alongside the existing marks.
  - Rework the home OG raster to a **wordmark-and-tagline** composition (not the centered icon).
  - Generate three 1200x630 share cards from the SVG source: `share-trivia.png`,
    `share-liarliar.png`, and a generic `share-join.png` - each with "Join my game" and the
    small top-left Branch Out mark, the per-game ones carrying that game's art.
  - Copy the new rasters into `apps/web/public/` like the existing set; document them in
    `BRAND.md` as generated (do not commit) output.
- `apps/control-plane`: a public `GET /rooms/:code/preview` returning the minimum an unfurl
  needs - `{ code, selectedGame, status }` - with **no membership/auth requirement** and no
  member or session detail. Returns 404 for an unknown code.
- `apps/web`:
  - `app/join/page.tsx` gains `generateMetadata` that reads `?code=`, fetches the preview
    server-side, and sets the OG/Twitter card to the matching share image (fallback to
    `share-join.png` on null/unknown game or any fetch failure), with title "Join my game".
  - Keep the home/root card wired to the new wordmark OG in `app/layout.tsx`.
  - Add `twitter:card = summary_large_image` so the large card renders on X and iMessage.
- A short brand note documenting the game-mark rules so future game logos stay consistent.

Out:

- Implementing the Liar Liar game itself (engine, questions, client) - this ships the **logo
  only**; the game is a later spec.
- Runtime/edge image generation (`next/og` `ImageResponse`). The game set is small and fixed, so
  pre-rendered static cards are simpler and more reliable than per-request rendering. If share
  cards ever need per-room text (host name, player count) we revisit with `ImageResponse`.
- Animated or localized cards; per-room dynamic text beyond the fixed "Join my game".
- Exposing any private room data on the public preview endpoint (members, session ids, config).

## Approach

- **Marks are SVG source, treated like code** (as in 0003). Author the two game marks by hand to
  the family rules, then export their raw strings from `packages/brand` and rasterize in the
  existing `scripts/generate-rasters.mjs` (sharp) - no new image pipeline.
- **Static share cards, dynamic selection.** Because the games are a small fixed set and the
  overlay text is always "Join my game", pre-render one card per game plus a generic fallback at
  build time. The only dynamic decision is *which* static card a given share link points at, made
  in `generateMetadata` from the room's `selectedGame`. This keeps unfurls fast and cache-friendly
  and avoids shipping a runtime renderer.
- **Public preview, not `getRoom`.** `getRoom` requires the caller be a room member, so a crawler
  (no cookie) or a not-yet-joined visitor cannot use it. Add a narrow public
  `GET /rooms/:code/preview` that leaks nothing beyond the selected game and status. The web layer
  calls it server-side inside `generateMetadata`; on any error it silently falls back to the
  generic card so a bad/expired code still unfurls as a valid Branch Out invite.
- **Composition.** Share cards: game art filling the frame on the `#0d0a15` canvas, a bottom-left
  "Join my game" headline in the system stack, and the Branch Out favicon mark in the top-left
  safe area. Home card: the `branchout-logo.svg` lockup (wordmark + tagline) centered on the same
  canvas. All respect the 10% safe area from `BRAND.md`.
- **Voice:** ASCII-only, terse, warm (Trellis language rules) for every string and alt text.

## Acceptance

- [ ] `assets/game-trivia.svg` and `assets/game-liarliar.svg` render correctly, read as the same
      family as the existing marks, and each keeps the single gold root node.
- [ ] `packages/brand` exports the two game marks and generates `share-trivia.png`,
      `share-liarliar.png`, `share-join.png`, and the reworked wordmark home OG, copying them into
      `apps/web/public/`; `BRAND.md` lists them as generated output.
- [ ] The home page emits an OG image showing the wordmark and tagline (not the bare icon).
- [ ] `GET /rooms/:code/preview` returns `{ code, selectedGame, status }` for a known code with no
      auth, exposes no member/session data, and 404s an unknown code.
- [ ] Opening `/join?code=XXXX` for a room that selected Trivia emits OG/Twitter tags pointing at
      the Trivia share card with title "Join my game"; a room with no game (or a fetch failure)
      falls back to `share-join.png`.
- [ ] `twitter:card` is `summary_large_image` so large cards render on X/iMessage.
- [ ] Tests cover the `generateMetadata` game-to-card mapping and its fallback, the preview
      endpoint (known/unknown code, no leakage), and an e2e check that the join page serves the
      expected OG tags for the happy path and the fallback.
- [ ] Mobile-first is unaffected (OG is metadata only); no player-facing layout regresses.
