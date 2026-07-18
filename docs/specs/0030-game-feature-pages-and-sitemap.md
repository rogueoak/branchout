# 0030 - Game feature pages, sitemap, and home links

> **Revision (2026-07-18, front-door consolidation).** The feature page is reworked to a hero-first
> layout and **every game gets a page, including insider games** (served on the insider surface,
> protected). The "How to play" and "Categories" sections are removed from the page; the rules
> section (spec `0051`) stays. The home/index cards are now the unified `GameCard` (spec `0065`).
> The original spec text below is updated in place to describe the current, shipped behavior.

## Problem

Each game needs a single, consistent **page of its own** - one a first-time visitor reads to decide
whether to play, and one search can rank. The original feature page (Trivia, Liar Liar) got close but
carried sections we no longer want (a "How to play" teaser duplicated by the in-game/help rules, and a
"Categories" block that split library taxonomy from marketing topics), led with the small game *mark*
instead of hero art, and **did not exist at all for insider games** - which 404 on the apex and had
only a card on the insider landing.

We want one hero-first feature page per game, the same on the public site and the insider surface
(insider just protected), with the home and `/games` cards linking to it, and a sitemap that lists the
public pages.

## Outcome

- A **games index** (`/games`) listing every public game as a unified `GameCard` (spec `0065`), and a
  **feature page per game** at `/games/[slug]`, laid out top to bottom:
  1. the game's **hero image** across the top (the 16:9 hero art, `GAME_HERO[slug]`),
  2. the **game icon (mark) + title inline** beneath the hero,
  3. directly under the title, the **badge + tags** row. Unlike the card (which drops the tags,
     spec `0065`), the page **keeps the tags and renders them as `Chip` pill components** (not floating
     text), so a visitor can see a game's facets on its page,
  4. the **Rules** section (objective + sections via `RulesContent`, spec `0051`),
  5. a closing **"Ready to play {name}?"** CTA that starts the game.
  - The old **"How to play"** teaser section and the **"Categories"** section are **removed**.
- **Every game has a feature page, including insider games.** On the **apex** an insider game's
  `/games/[slug]` still 404s (it must not exist on the public site). On the **insider surface** the
  same page renders for insider (and public) games, behind the insider layout gate - the two surfaces
  render the identical page; only the insider one is protected. The insider landing card's "Details"
  link (spec `0065`) points here.
- Each **public** feature page keeps **strong SEO**: a unique `<title>` + meta description, canonical
  URL, Open Graph/Twitter tags reusing the per-game share cards (spec `0025`), and JSON-LD
  (`VideoGame`) structured data. Insider pages are `noindex` and never emit SEO/canonical/JSON-LD.
- The **home page cards and the `/games` cards** are the unified `GameCard` whose Details link targets
  the feature page; the page's CTA drives play via the start-a-game flow (spec `0029`).
- A **`sitemap.xml`** (and `robots.txt`) includes the home, `/games`, every **public** `/games/[slug]`,
  and the legal pages (spec `0031`). Insider pages are excluded (they render only on the gated surface).
- Covered by tests: the page layout/sections, insider gating (apex 404 vs. insider-surface render),
  metadata/SEO per public page, the CTA, and the sitemap contents.

## Scope

**In**

- **Per-game display + marketing metadata** in one place (registry `lib/games/registry.ts` +
  `lib/games/catalog.ts` + library `lib/games/library.ts` + `lib/games/heroes.ts`), read by the card
  (spec `0065`) and the feature page so nothing drifts. Adding a game stays "a module + its entries".
- **web routes**:
  - `/games` index - a grid of unified `GameCard`s (spec `0065`), with the existing search/category
    filter (spec `0051`) retained.
  - `/games/[slug]` feature page, **reworked** to the hero-first layout above: hero, icon + title
    inline, badge + tags, Rules section, closing CTA. `generateStaticParams` over the known games;
    `generateMetadata` per **public** game (title, description, canonical, OG/Twitter reusing the
    game's share card); JSON-LD on public pages.
  - **Surface-aware resolution:** the page resolves the game via a surface-aware lookup - public games
    resolve on both surfaces; insider games resolve **only** when `getSurface().insider` is true, else
    `notFound()`. Mirror `/games/[slug]` into the insider tree (`app/insider/games/[slug]`, a thin
    re-export like `app/insider/rooms`/`app/insider/join`) so the insider host serves it behind the
    layout gate.
  - `app/sitemap.ts` and `app/robots.ts` enumerating home, `/games`, each **public** `/games/[slug]`,
    `/privacy`, `/terms`, absolute via `SITE_URL` (insider pages excluded, unchanged).
- **Home + index wiring**: cards are the unified `GameCard` (spec `0065`); their Details link points
  at `/games/[slug]`; the "Start a game" affordance uses the flow in spec `0029`.
- The **top nav** (spec `0028`) "Games" link targets `/games` (apex) / the insider games listing
  (insider surface), unchanged.
- Tests: page layout + section presence/absence (no How-to-play, no Categories), insider gating on
  both surfaces, per-page metadata/JSON-LD for a public game, the CTA, sitemap/robots output, and a
  360px render check.

**Out**

- The **unified `GameCard`** itself - spec `0065`.
- The **share card images** - spec `0025` generates them; this spec references them.
- The **start-a-game / skip-create-room behavior** behind the CTA - spec `0029`.
- The **rules content + `RulesContent` renderer + taxonomy** - spec `0051`; this page renders them.
- The **insider surface gate/layout and host rewrite** - spec `0035`; this spec adds a mirrored route
  under the existing gate, it does not change the gate.
- Blog/SEO content beyond the feature pages; localization; per-game screenshots/video.

## Approach

- **Hero-first, fewer sections.** Lead with the hero art (the `GAME_HERO` SVG in a 16:9 box that owns
  its sizing so it never overflows 360px), then icon + title inline, then the badge + tags row (the
  same resolved data the card uses, spec `0065`), then Rules, then the closing CTA. Drop the
  How-to-play teaser (the rules cover it and it lives in-game via the help sheet, spec `0051`) and the
  Categories block (the tags row already surfaces the taxonomy; marketing "topics" are dropped from
  the page but stay available for SEO/JSON-LD copy).
- **One page, two surfaces, gated not duplicated.** The feature page is surface-aware: it resolves an
  insider game only on the insider surface and 404s it on the apex, exactly like the room picker gates
  by `getSurface()` (spec `0035`, feedback `0029`). The insider route is a thin re-export mirrored
  into the gated `/insider` tree (the pattern `app/insider/rooms` and `app/insider/join` already use),
  so the same component renders on both hosts and the insider one inherits the layout's auth gate. No
  second implementation.
- **SEO only where it is public.** `generateMetadata`, canonical, OG/Twitter, and JSON-LD emit only
  for public games; an insider page returns `noindex` metadata and no structured data, and never
  appears in the sitemap (which maps `PUBLIC_GAME_CATALOG`, unchanged).
- **Sitemap/robots as metadata routes**, generated from the public catalog so every new public game
  auto-appears and no insider slug can leak in.
- **Mobile-first, ASCII-only, on-brand voice** (Trellis language) for all copy and structured data.

## Acceptance

- [ ] `/games` lists every public game as a unified `GameCard` (spec `0065`), each linking to its
      feature page via Details; the search/category filter still works.
- [ ] `/games/[slug]` renders, top to bottom: hero art, icon + title inline, a badge + tags row (the
      tags as `Chip` pills), a
      Rules section, and a closing "Ready to play {name}?" CTA - and does **not** render a "How to
      play" section or a "Categories" section. Reads well at 360px.
- [ ] An insider game's `/games/[slug]` **404s on the apex** and **renders on the insider surface**
      behind the insider gate (via the mirrored `/insider/games/[slug]` route); a signed-out or
      non-insider visitor cannot reach it.
- [ ] Each **public** feature page emits a unique title + meta description, a canonical URL, OG/Twitter
      tags using that game's share card, and valid JSON-LD; an **insider** page is `noindex` with no
      canonical/JSON-LD.
- [ ] The home + `/games` cards' Details link targets `/games/[slug]`; the feature-page CTA starts the
      game via the flow in spec `0029`.
- [ ] `sitemap.xml` includes home, `/games`, every **public** `/games/[slug]`, `/privacy`, `/terms` as
      absolute URLs (no insider slug), and `robots.txt` references it.
- [ ] Adding a public game makes it appear in `/games`, the sitemap, and the home teaser with no
      per-surface edits; adding an insider game gives it an insider-surface page and a landing card,
      never an apex page or a sitemap entry.
- [ ] Tests cover the layout/sections, insider gating on both surfaces, public-page metadata/JSON-LD,
      the CTA, and the sitemap/robots output. `pnpm build`, lint, typecheck, and tests are green.
