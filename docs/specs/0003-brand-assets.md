# 0003 - Brand assets

## Problem

Branch out needs a visual identity that reads as part of the rogueoak family (Trellis, Canopy,
Spectra) while carrying its own party-game energy. You need the icon, favicon, and wordmark as
real, versioned assets an app can import, plus a place they live in the monorepo.

The concept and colors are decided (Confetti Oak, matching the `0002` theme). The source SVGs
already exist in `assets/`; this spec packages and documents them.

## Outcome

- Branch out has an app icon, a favicon that stays legible at 16px, and a wordmark lockup.
- Assets follow rogueoak conventions: dark panel, radial glow, branching node-graph oak, the
  gold root node (`#d2a463`), two-pass neon strokes, system-font wordmark with the accent rule
  and a lowercase tagline.
- `apps/web` uses them for the favicon, header logo, and social/OpenGraph image.

## Scope

In:
- `assets/branchout-icon.svg` - 512 app icon (Confetti Oak: wide two-level branch fan, each
  leaf-node a party color, gold root).
- `assets/branchout-favicon.svg` - simplified mark (trunk + three bright nodes + gold root) that
  holds at 16-32px.
- `assets/branchout-logo.svg` - 520x150 lockup, 84 tile mark + "Branch out" wordmark ("out" in
  the Confetti gradient) + tagline "where game night grows".
- `packages/brand` - re-exports the SVGs and a generated favicon `.ico`/PNG set for web.
- Brand notes: palette, the gold-root rule, safe-area, and "do not restyle the mark ad hoc".

Out:
- Animated or per-game variants, avatar character art (a later accounts spec), and native app
  icon sets (iOS/Android) until those apps exist.

## Approach

- The three SVGs are the source of truth; treat them like code (reviewed, versioned). The
  gradient is warm -> cool (`#FBBF24 -> #EC4899 -> #7C3AED`) to echo the family's spark while
  reading as party, and it keeps the gold root node to tie back to the oak family.
- `packages/brand` exposes import paths and a small build step that rasterizes the favicon into
  the sizes browsers want (16, 32, 180 apple-touch) and an OpenGraph PNG. Keep raster output out
  of git or generated at build time - SVG is the source.
- Voice for any tagline or alt text follows Trellis language rules: ASCII only, terse, warm.

## Acceptance

- [ ] `assets/` holds the three SVGs; each renders correctly and matches the rogueoak family
      conventions (verified against the reference proof).
- [ ] Favicon is legible at 16px; app icon holds down to 48px.
- [ ] `packages/brand` exports the SVGs and generates the browser favicon set + an OpenGraph
      image from the SVG source.
- [ ] `apps/web` shows the wordmark in its header and the favicon in the tab.
- [ ] Brand notes document the palette, the gold-root rule, and safe-area so the mark is not
      restyled ad hoc.
