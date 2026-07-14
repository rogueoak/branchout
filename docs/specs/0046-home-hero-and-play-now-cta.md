# 0046 - Home hero art, "Play now" -> /games, and the rooms autofocus fix

## Problem

The marketing landing page (`apps/web/components/LandingContent.tsx`) sells each game with only the
small 512 game *mark* - the compact icon rendered inline beside the title. There is no hero art that
shows off a game at a glance, so the teaser reads as a plain list rather than a shop window.

Two smaller friction points ride along:

- The signed-in hero CTA ("Play now") links straight to `/rooms`, which drops the player on the
  host/join screen with no game chosen - they create a room and *then* pick. Sending them to `/games`
  first lets them choose the game before hosting.
- Navigating to `/rooms` ("Play a game") on a phone, the "Join a room" code input grabs focus on
  load, popping the mobile keyboard and burying the primary "Create a room" action. This is annoying
  and off-mission for a mobile-first surface.

Audience: every visitor to the marketing landing page and the rooms home - phone-first.

## Outcome

- Each public game teaser card on the home page shows a **wide hero illustration** (one per game) at
  the top of the card, above the title. The art is on-brand (brand radial tile, two-pass spark
  strokes, party leaf nodes, the single gold root `#d2a463`) and composed as a ~16:9 scene, not a
  reskinned icon. It scales down cleanly and stays inside a 360px phone viewport.
- The signed-in hero primary CTA "Play now" links to `/games` (pick a game first). The signed-out
  "Sign up free" CTA still links to `/signup`. The per-card "Play <game> now" shortcuts still deep-
  link into `/rooms?game=<slug>` (unchanged).
- Navigating to `/rooms`, the "Join a room" code input does **not** take focus on mount, so the
  mobile keyboard stays down and "Create a room" is the visible primary action.

## Scope

**In:**

- New source SVGs `assets/hero-trivia.svg` and `assets/hero-liarliar.svg` (800x450 viewBox).
- New brand exports `@branchout/brand/hero-trivia` and `@branchout/brand/hero-liarliar` (text-loaded
  string literals, mirroring the existing `trivia`/`liarliar` mark exports), plus a brand-package
  test asserting each hero is an 800x450 SVG carrying `#d2a463`.
- Rendering the hero in each home teaser card, responsive and good at 360px.
- Changing the signed-in "Play now" hero CTA target to `/games`.
- Making the rooms join-code input `autoFocus={false}` and a test proving it is not focused on mount.

**Out:**

- The `/games` "coming soon" banner and subscribe button (separate PR).
- The insider surface (separate PR).
- New hero art for Teeter Tower (insider-only) or any raster/OG share cards for the heroes.

## Approach

- **Hero SVGs.** Study `assets/game-trivia.svg`, `assets/game-liarliar.svg`,
  `assets/branchout-icon.svg`, and `packages/brand/BRAND.md`. Keep the family skeleton (radial tile
  `#221836 -> #0d0a15`, the violet glow, two-pass spark strokes gold -> pink -> violet, party leaf
  nodes with halos + white highlights, the gold root). Widen to an 800x450 scene: the branch motif
  (Trivia's question mark, Liar Liar's masquerade mask) sits on the right, a system-font wordmark +
  one-line tagline on the left. Text uses the `-apple-system, ..., sans-serif` stack (the sharp
  pipeline embeds no fonts).
- **Brand exports.** Add `src/hero-trivia.ts` / `src/hero-liarliar.ts` (import the SVG as text), the
  two tsup entries, the two `package.json` exports, and the barrel re-exports - exactly mirroring the
  `trivia`/`liarliar` marks. `pnpm --filter @branchout/brand build` produces `dist/hero-*.js`.
- **Landing render.** Import the two hero strings in `LandingContent.tsx` and map them by catalog
  slug (`trivia`, `liar-liar`). Render each at the top of its card in an `aspect-[16/9]` box with the
  SVG `block w-full h-full` so nothing leaks past the card and overflows the phone (recall the
  learning about content-bearing cards inheriting `white-space: nowrap` - the box owns its own
  sizing). aria-hidden (the card title + link name the game already). A slug with no hero renders no
  art, so the card still stands.
- **CTA.** Flip the signed-in `primaryCta.href` from `/rooms` to `/games`.
- **Autofocus.** A code search found NO `autoFocus` in `RoomsHome.tsx`, and canopy's `Input`
  (`@rogueoak/canopy` seeds) is a bare `forwardRef` `<input>` with no `autoFocus` default - so no app
  or library code focuses the field. A jsdom render confirms the input is not focused on mount there;
  the reported behavior is a **browser heuristic** (some mobile browsers focus the first empty text
  input on a page). The minimal correct guard is an explicit `autoFocus={false}` on the join-code
  `Input`, documented inline, with a test asserting the input is not the active element on mount.

## Acceptance

- [ ] `assets/hero-trivia.svg` and `assets/hero-liarliar.svg` exist, each an 800x450 scene reusing
      the brand motifs and containing exactly one gold root `#d2a463`.
- [ ] `@branchout/brand/hero-trivia` and `@branchout/brand/hero-liarliar` are exported; the brand
      build emits `dist/hero-trivia.js` and `dist/hero-liarliar.js`; a brand test asserts each hero is
      an 800x450 SVG with `#d2a463`.
- [ ] The home teaser renders each game's hero, aria-hidden, scaling cleanly at 360px; a page test
      asserts the wide hero SVG (`viewBox="0 0 800 450"`) is present in each card with the gold root.
- [ ] Signed-in hero "Play now" links to `/games`; signed-out "Sign up free" links to `/signup`;
      per-card "Play <game> now" still deep-links `/rooms?game=<slug>` - covered by page tests.
- [ ] The rooms join-code input is not focused on mount - covered by a `RoomsHome` test.
- [ ] `docs/overview/features.md` marketing-landing bullet mentions the hero art and the /games CTA.
