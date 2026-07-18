# Plan 0030 - Hero-first feature pages + insider per-game pages

Implements the revised spec `docs/specs/0030-game-feature-pages-and-sitemap.md` (Revision
2026-07-18). Reworks `/games/[slug]` to a hero-first layout, removes two sections, and gives every
game a feature page - insider games served on the gated insider surface via a mirrored route.

## Steps

1. **Surface-aware resolver + noindex metadata** - `apps/web/lib/games/catalog.ts`
   - Add `getFeatureEntry(slug, surface)`: public games resolve on both surfaces; an insider game
     resolves only when `surface.insider` is true, else `undefined`. Does NOT weaken the public-only
     `getCatalogEntry` (SEO/JSON-LD/sitemap helpers stay public-only).
   - Add `insiderFeatureMetadata(entry)`: title/description marked `noindex, nofollow`, no canonical,
     no OG/Twitter share card, no JSON-LD.

2. **Rework the feature page** - `apps/web/app/games/[slug]/page.tsx`
   - Read `getSurface()`; resolve via `getFeatureEntry` -> `notFound()` when undefined (insider slug
     404s on the apex, unknown slug 404s everywhere).
   - Layout top->bottom: 16:9 hero (`getGameCard(slug).hero`, falls back to the mark), mark + title
     inline, badge + tags row (matches the card: catalog badge suppressed for insider games, plus the
     top-right "Insiders" badge), Rules (`RulesContent`), closing "Ready to play {name}?" CTA.
   - REMOVE the "How to play" `<ol>` and the entire "Categories" section.
   - JSON-LD (`gameJsonLd`) rendered for public games only. `generateMetadata` branches:
     insider -> `insiderFeatureMetadata`, public -> `gameFeatureMetadata`.
   - Chrome is surface-aware (TopNav label/linkOrigin/insider, `Footer` linkOrigin), matching
     `RoomsHome`, so links resolve on the insider host.

3. **Mirror the route into the insider tree** - `apps/web/app/insider/games/[slug]/page.tsx`
   - Thin re-export of the apex page's `default` + `generateMetadata` (same pattern as
     `app/insider/rooms`, `app/insider/join`). Middleware already blanket-rewrites every insider-host
     path with `/insider`, so `insider.host/games/<slug>` -> `/insider/games/<slug>` with NO
     middleware change; the insider layout gate covers it.

4. **Re-enable Details on insider cards** - `apps/web/app/insider/InsiderHome.tsx`
   - Drop the `showDetails={false}` stopgap (now the insider per-game page exists), so the card's
     "Details" link resolves to the gated feature page.

5. **Docs** - `docs/overview/features.md` (new hero-first feature-page bullet; correct the stale
   "insider games have no public feature page" claim) and `docs/overview/architecture.md` (surface-
   aware feature page + insider route mirror, alongside the rooms/join mirror note).

## Tests

- `apps/web/app/games/[slug]/page.test.tsx` - render the async Server Component with a controllable
  host (mock `next/headers`) and viewer (mock `lib/session`), sentinel `notFound()`:
  - public page: hero (viewBox `0 0 800 450`) + mark (`0 0 512 512`) + h1 title, badge + tags row,
    Rules present, "Ready to play" CTA, anon vs signed-in CTA href, JSON-LD present; "How to play"
    and "Categories" headings ABSENT.
  - insider gating: insider slug 404s on apex, renders on the insider surface (Insiders badge, Rules,
    NO JSON-LD); unknown slug 404s on both.
  - metadata: public -> title/description/canonical, no robots; insider -> `noindex` no canonical;
    insider-on-apex + unknown -> not-found title.
- `apps/web/lib/games/catalog.test.ts` - `getFeatureEntry` surface matrix + `getCatalogEntry`
  public-only unchanged; `insiderFeatureMetadata` noindex/no-canonical/no-OG.
- `apps/web/app/insider/InsiderHome.test.tsx` - Details link now present, targets `/games/<slug>`.
- `e2e/tests/mobile-smoke.spec.ts` - feature page at 360px asserts hero + Rules + Ready-to-play, and
  that How-to-play/Categories are gone.
- `e2e/tests/insider.spec.ts` - insider feature page renders behind the gate (Details -> page stays
  on the insider host, no JSON-LD), apex 404s the same slug, signed-out is sent to the apex login.

## Verification

`pnpm --filter @branchout/brand build` (heroes), then `@branchout/web` lint + test + build and
`@branchout/e2e` typecheck + lint - all green. The e2e specs were ported/updated but not executed
here (no Docker stack).
