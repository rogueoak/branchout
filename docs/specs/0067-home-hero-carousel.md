# 0067 - Home hero carousel of game hero cards

## Problem

The marketing landing page (`apps/web/components/LandingContent.tsx`) opens with a plain text hero:
the `where game night grows` heading, a one-line subhead, and two CTA buttons. The games themselves
only appear far down the page in the "What you can play" grid. Nothing at the top of the page *shows*
a game, so the first thing a visitor sees is words, not play.

We want the top of the home page to lead with the games: a **hero carousel** that rotates through a
portrait hero card for each public game, with the `where game night grows` tagline (and the existing
subhead + CTAs) sitting directly under it.

Audience: every visitor to the marketing landing page - phone-first.

## Outcome

- The landing page opens with a **hero carousel** above the tagline. It rotates through one portrait
  hero card per public game. Tapping a card goes to that game's feature page (`/games/<slug>`).
- The carousel **auto-advances** (~5s per slide), **pauses** on hover / focus / touch, supports
  **swipe** on touch and **dot** controls for direct selection, and honors `prefers-reduced-motion`
  by not auto-advancing.
- Directly under the carousel: the `where game night grows` `<h1>`, the existing subhead, and the
  existing "Play now / Sign up free" + "Browse games" CTA row - unchanged in behavior.
- Everything is mobile-first and good at 360px: a single portrait card fills the column, art scales
  cleanly, controls are thumb-reachable, tap targets >= 44px.
- The carousel currently holds the **two public games** (Trivia, Liar Liar). Insider games stay out
  (they are gated). Adding a public game later automatically adds a slide - no carousel edits.

## Scope

**In:**

- **Canopy carousel dots.** The home carousel is built on canopy's `Carousel` (embla, spec 0061) -
  no custom carousel. Canopy ships `Carousel*` + `CarouselPrevious/Next` but no slide indicator, so
  add a reusable `CarouselDots` part to canopy (reads the `useCarousel` api), test it, and publish a
  canopy patch (e.g. 1.1.1). Auto-advance uses the official `embla-carousel-autoplay` plugin passed
  through canopy's existing `plugins` prop.
- New portrait hero SVGs `assets/hero-trivia-portrait.svg` and `assets/hero-liarliar-portrait.svg`
  (3:4, `0 0 600 800` viewBox), on-brand with the existing hero family (radial tile, violet glow,
  two-pass spark strokes gold -> pink -> violet, party leaf nodes, the gold root `#d2a463`),
  recomposed vertically so they read on a phone.
- New brand exports `@branchout/brand/hero-portrait-trivia` and `.../hero-portrait-liarliar`
  (text-loaded string literals), their tsup entries and `package.json` exports, and a brand test
  asserting each portrait hero is a 600x800 SVG carrying `#d2a463`.
- A web portrait-hero map `apps/web/lib/games/heroes-portrait.ts` (`GAME_HERO_PORTRAIT`), and an
  optional `heroPortrait` field on `GameCardData` resolved by `getGameCard` (falls back to the wide
  hero when a game ships no portrait), so the carousel does the same single catalog lookup every
  other surface does.
- A new client component `apps/web/components/home/HomeHeroCarousel.tsx` built on canopy `Carousel` +
  autoplay plugin + `CarouselDots`. Each slide is an `<a href={featurePath(slug)}>` wrapping the
  portrait art and the game name.
- Wiring the carousel into `LandingContent` above the `where game night grows` hero block.
- A Playwright e2e spec (`e2e/tests/home-hero-carousel.spec.ts`) at a 360px viewport: the carousel
  renders both slides, the dots switch slides, and tapping a slide lands on `/games/<slug>`.
- A component unit test for the carousel (dots render one per slide; a slide links to the feature
  page).

**Out:**

- Any change to game gating / which games are public (still Trivia + Liar Liar; spec-0043 gating
  untouched).
- Portrait art for insider games or the insider surface.
- The "What you can play" grid, "How it works", and the wide landscape heroes - all unchanged.
- Raster/OG share cards for the portrait heroes.

## Approach

- **Canopy `CarouselDots`.** Add a `CarouselDots` part in canopy's carousel module that reads
  `useCarousel()` for the embla api, renders one `<button>` per `api.scrollSnapList()`, marks the
  selected one (`aria-current`), and calls `api.scrollTo(i)` on click. Match canopy's existing
  component conventions (cn, forwardRef, `CarouselControlProps` style, `'use client'`). Add it to the
  branches barrel + build, add a test alongside the existing carousel test, cut a patch release the
  repo's normal way (changeset / release workflow), and bump branchout's `@rogueoak/canopy` to it.
- **Portrait SVGs.** Follow `packages/brand/BRAND.md` and the existing `assets/hero-trivia.svg` /
  `assets/hero-liarliar.svg` as the reference. Keep the family skeleton (radial tile
  `#221836 -> #0d0a15`, violet glow, two-pass spark strokes, party leaf nodes with halos + white
  highlights, the single gold root). Recompose for a `0 0 600 800` portrait frame: the branch motif
  (Trivia's question mark, Liar Liar's mask) stacked above a system-font wordmark. Text uses the
  `-apple-system, ..., sans-serif` stack (the pipeline embeds no fonts).
- **Brand + web wiring.** Mirror the existing hero export path exactly (spec 0046): `src/*.ts` text
  import -> tsup entry -> `package.json` export -> `heroes-portrait.ts` map -> `getGameCard`. Build
  the brand package before the web app consumes it.
- **Carousel component.** Client component (owns the `use client` boundary like `LandingContent`).
  `Carousel` with `opts={{ loop: true }}` and, unless reduced-motion, an `Autoplay({ delay: 5000,
  stopOnMouseEnter: true, stopOnFocusIn: true })` plugin. `CarouselContent` / `CarouselItem` hold the
  slides; `CarouselDots` under the viewport. Read `prefers-reduced-motion` via `matchMedia` to drop
  the autoplay plugin.
- **Layout.** Carousel sits in its own block at the top of the hero `<section>`, capped to a phone-
  friendly width (e.g. `max-w-xs`) and centered; the `where game night grows` block follows directly
  below it, so the tagline reads as the caption to the rotating cards.

## Testing

- `e2e/tests/home-hero-carousel.spec.ts` at 360x780: both slides present, dot 2 activates the Liar
  Liar slide, tapping the active slide navigates to `/games/<slug>`. Runs with reduced-motion on to
  keep timing deterministic (no auto-advance flake).
- Carousel unit test (vitest + RTL): dots render one per slide and reflect the active slide; each
  slide links to its feature page.
- Canopy `CarouselDots` test in the canopy repo (one dot per slide; click scrolls; `aria-current` on
  the selected dot).
- Brand-package test: each portrait hero is a 600x800 SVG containing `#d2a463`.
- `pnpm --filter @branchout/brand build`, `pnpm --filter @branchout/web build`, lint, and
  `format:check` pass before merge.
