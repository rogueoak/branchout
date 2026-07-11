# 0030 - Game feature pages, sitemap, and home links

## Problem

Each game is invisible to search and to a first-time visitor deciding whether to play. The only game
content is a hardcoded `GAMES` array inside `LandingContent` (name, one line, a category string) and
the home teaser cards link straight into the play path. There is no per-game **landing page** to
rank for "trivia party game", "online fibbing/bluffing game", etc., no place to explain a game and
convert, and no **sitemap** telling crawlers what exists.

We want an **unauthenticated feature page per game** with strong SEO and a clear play CTA, the home
page linking to those pages, and a sitemap that includes them.

## Outcome

- A **games index** (`/games`) listing every game, and a **feature page per game**
  (`/games/[slug]`, e.g. `/games/trivia`, `/games/liar-liar`) - unauthenticated, server-rendered,
  each with: an overview (what it is, how a round plays, categories), the game's mark/art, and a
  clear **"Start a game" CTA**.
- Each feature page has **strong SEO**: a unique `<title>` + meta description, canonical URL, Open
  Graph/Twitter tags reusing the per-game share cards (spec `0025`), and JSON-LD (`Game`/`VideoGame`)
  structured data.
- The **home page game cards link to these feature pages** (learn first), while the page's CTA drives
  play via the `?game=<slug>` deep link into the room create flow (spec `0029`), which skips the game
  pick step.
- A **`sitemap.xml`** (and `robots.txt`) includes the home, `/games`, every `/games/[slug]`, and the
  legal pages (spec `0031`), so the new pages are crawlable.
- Covered by tests: metadata/SEO per page, the CTA deep link, and the sitemap contents.

## Scope

In:

- **Per-game marketing metadata** - a single source of truth (`lib/games/catalog.ts` or an extension
  of the web registry `lib/games/registry.ts`) holding, per game: `slug`, name, tagline, a longer
  description, how-to-play steps, category list, the mark and share-card image, and SEO copy. The
  room picker card (spec `0029`) and the home teaser read the **same** source so nothing drifts.
- **web routes**:
  - `/games` index (grid of game cards linking to each feature page).
  - `/games/[slug]` feature page: hero (mark + name + tagline + Start CTA), how-it-works, categories,
    a secondary CTA, footer. `generateStaticParams` over the known games; `generateMetadata` per
    game (title, description, canonical, OG/Twitter reusing the game's share card).
  - **JSON-LD** structured data on each feature page.
  - `app/sitemap.ts` and `app/robots.ts` (Next.js metadata routes) enumerating home, `/games`,
    each `/games/[slug]`, `/privacy`, `/terms`, absolute via `SITE_URL`.
- **Home wiring**: point the existing teaser cards at `/games/[slug]` instead of the raw play path;
  the "Start a game" affordance on a feature page uses the `?game=<slug>` deep link (spec `0029`).
- The **top nav** (spec `0028`) "Games" link targets `/games`; feature/index pages render the nav.
- Tests: per-page metadata, JSON-LD presence, CTA href (deep link), sitemap/robots output, and a
  mobile-first render check.

Out:

- The **share card images** themselves - spec `0025` generates them; this spec references them.
- The **room create/deep-link behavior** - spec `0029` owns the flow and the `?game=` contract; this
  spec only produces links to it.
- Blog/SEO content marketing beyond the feature pages; localization; A/B testing of copy.
- Per-game screenshots/video captures (use the existing marks/share art for now).

## Approach

- **One catalog, many surfaces.** Lift per-game display + marketing data into one module so the home
  teaser, the room picker card (spec `0029`), and the feature page all read it - adding a game stays a
  one-place edit and the copy never diverges. Keep it colocated with the web game registry so a game
  is "a module + a catalog entry".
- **Static, SEO-first pages.** Feature pages are static (`generateStaticParams`) with full
  `generateMetadata` - unique title/description, `alternates.canonical`, and OG/Twitter pointing at
  the game's existing share card - plus JSON-LD for rich results. `metadataBase` (already seeded by
  `SITE_URL`) makes image/canonical URLs absolute (the OG-raster learning).
- **Learn-then-play funnel.** Home cards now *inform* (link to the feature page) rather than jump
  straight to play; the feature page is where the conversion CTA lives, deep-linking into the room
  flow with the game preselected so the host lands on invite (spec `0029`). Signed-out visitors hit
  signup first via that flow's existing gating.
- **Sitemap/robots as metadata routes.** Use Next's `app/sitemap.ts` + `app/robots.ts` so the list
  is generated from the same catalog (no hand-maintained XML), and every new game auto-appears.
- **Mobile-first, ASCII-only, on-brand voice** (Trellis language) for all copy and structured data.

## Acceptance

- [ ] `/games` lists every game, each card linking to its feature page.
- [ ] `/games/trivia` and `/games/liar-liar` render an overview, how-to-play, categories, the game
      mark, and a Start CTA; both read well at 360px.
- [ ] Each feature page emits a unique title + meta description, a canonical URL, OG/Twitter tags
      using that game's share card, and valid JSON-LD.
- [ ] The home teaser cards link to `/games/[slug]`; the feature-page Start CTA uses the
      `?game=<slug>` deep link into the room flow (spec `0029`).
- [ ] `sitemap.xml` includes home, `/games`, every `/games/[slug]`, `/privacy`, and `/terms` as
      absolute URLs, and `robots.txt` references it.
- [ ] Adding a game to the catalog makes it appear in `/games`, the sitemap, and (via the shared
      source) the home teaser and room picker with no per-surface edits.
- [ ] Tests cover per-page metadata/JSON-LD, the CTA deep link, and the sitemap/robots output.
</content>
