# 0051 - Game library: categories, tags, and an always-available rules overview

## Problem

The catalog is about to grow from three games to more than a dozen. Today a game carries only a
name, tagline, one-line summary, and a marketing `categories` list that is really *content* labels
(Trivia's "Nature/Food", Teeter's "Physics/Stacking"). There is no way to **organize or search the
library** by the kind of game it is (a word game, a drawing game, a two-player classic), and there
is no **full rules overview** a player can read before starting or - crucially - reach *while
playing* when they forget how a phase works. The existing "How to play" is a three-step teaser on
the public feature page only; it is not in the game, and insider games have no feature page at all.

This is the shared setup the next wave of games depends on: every new game needs a place to declare
what category and tags it belongs to and a place to declare its rules, and players need one
consistent way to read those rules on the listing surfaces and inside the game.

## Outcome

- Every game declares **categories** (broad genre, e.g. Party, Word, Drawing, Co-op, Strategy,
  Classic) and **tags** (facets, e.g. Teams, Hidden role, Bluffing, 2 players, Quick) from a single
  controlled vocabulary.
- The **/games index** shows each game's category/tag chips and gains a **search box + category
  filter** so a visitor can narrow the list ("word games", "co-op", type "draw").
- Every game has a structured **rules overview** (an objective plus headed sections: setup, a turn/
  round, scoring, key terms). It renders:
  - on the public feature page (`/games/[slug]`) as a full "Rules" section, and
  - inside the game, behind an always-present **help icon** in the game chrome that opens a
    **sheet** - sliding up from the bottom on a phone, in from the right on desktop - over the live
    game without ending it, dismissible by backdrop, the close button, or Escape.
- On the **insider index**, each game card gains a "How to play" affordance that opens the same
  rules content, so insider games (which have no public feature page) still surface their rules on
  their listing surface.
- The three shipped games (Trivia, Liar Liar, Teeter Tower) are backfilled with categories, tags,
  and a rules overview, so the feature ships live and the build-time completeness check holds.

## Scope

**In**

- A new web data module `apps/web/lib/games/library.ts`: the category + tag vocabularies, a
  `GameRules` shape, per-game library entries (categories, tags, rules), lookup + search/filter
  helpers, and a build-time completeness check (every registered game has a library entry, every
  declared category/tag is in the vocabulary).
- A pure `RulesContent` renderer reused by the feature page, the help sheet, and the insider card's
  "How to play".
- A responsive `Sheet` primitive (bottom on mobile, right on desktop) and a `HelpSheet` that wires
  it to a game's rules; a help-icon button added to `GameStage` for every mode.
- `/games` index: category/tag chips on cards + a client search/filter control.
- `/games/[slug]` feature page: a full Rules section and category/tag chips.
- Insider index: a "How to play" trigger per card opening the rules content.
- Backfill library entries for `trivia`, `liar-liar`, `teeter-tower`.
- Unit tests (library helpers, completeness, search/filter, `RulesContent`, `Sheet`/`HelpSheet`
  open/close + a11y) and e2e (open a game, toggle the help sheet; filter the /games index).

**Out**

- The new games themselves (each is its own spec; they add their own library entry the same way
  they add a registry + catalog entry).
- Per-content-item categorization changes (the marketing `categories` content labels stay as they
  are; the new library categories are a separate, game-level axis).
- Localizing rules text (English only, ASCII, per language rules).
- Persisting a player's filter/search or "last read rules" state.

## Approach

### Data: one library module, one vocabulary

`apps/web/lib/games/library.ts` (pure data + pure helpers, server- and client-safe - no
server-only imports, so the client help sheet can import it):

```ts
export const GAME_CATEGORIES = {
  party: 'Party',
  word: 'Word',
  drawing: 'Drawing',
  deduction: 'Deduction',
  cooperative: 'Co-op',
  strategy: 'Strategy',
  classic: 'Classic',
} as const;
export type GameCategory = keyof typeof GAME_CATEGORIES;

export const GAME_TAGS = {
  teams: 'Teams',
  'hidden-role': 'Hidden role',
  bluffing: 'Bluffing',
  wordplay: 'Wordplay',
  sketching: 'Sketching',
  trivia: 'Trivia',
  memory: 'Memory',
  spatial: 'Spatial',
  wit: 'Wit',
  deduction: 'Deduction',
  'two-player': '2 players',
  'small-group': 'Small group',
  'big-group': 'Big group',
  quick: 'Quick',
  'turn-based': 'Turn-based',
  'real-time': 'Real-time',
} as const;
export type GameTag = keyof typeof GAME_TAGS;

export interface RulesSection {
  heading: string;   // "Setup", "On your turn", "Scoring", "Good to know"
  body: string[];    // paragraphs; a section is one or more short paragraphs
}
export interface GameRules {
  objective: string;         // one sentence: how you win
  sections: RulesSection[];
}
export interface GameLibraryEntry {
  categories: GameCategory[]; // 1+, first is primary
  tags: GameTag[];
  rules: GameRules;
}
```

A `GAME_LIBRARY: Record<slug, GameLibraryEntry>` holds every game's entry (slug == registry id).
`toLibrary(module)` throws if a registered game has no entry - the same fail-loud pattern the
marketing catalog already uses, so adding a game *must* add its library entry. A unit test asserts
every `GAME_UI_LIST` id resolves and every declared category/tag key is in the vocabulary (a typo
like `tags: ['quik']` fails the test, not just TypeScript, since data may come from spread objects).

Helpers: `getGameRules(slug)`, `getLibraryMeta(slug)` (categories + tags with display labels),
`searchLibrary(query, { category })` over name/summary/tags (case-insensitive substring), and a
`categoriesInUse()` for the filter control's options (only categories some visible game uses).

### Rules rendering: one component, three homes

`RulesContent({ name, rules, howToPlay? })` is a pure presentational component: the objective as a
lead line, then each section as a heading + paragraphs, optionally the catalog's three how-to-play
steps as a quick-start strip. It has no dialog/positioning concerns, so the feature page renders it
inline, the help sheet renders it in the sheet body, and the insider card renders it in its sheet -
one source of truth for how rules look.

### The help sheet: bottom on mobile, right on desktop

Canopy ships `ResponsiveDialog` (bottom sheet on phones, **centred** modal on desktop) but no
side drawer, and the requirement is explicitly a **right** panel on desktop. So `components/game/
Sheet.tsx` composes the Radix Dialog primitive canopy already depends on (focus trap, `Escape`,
`aria-modal`, scroll lock, portal - all for free, so we do not hand-roll a11y) with our own content
positioning:

- phone: `fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl` + slide-up.
- desktop (`sm:`): `sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-full sm:max-w-md
  sm:rounded-none` + slide-in-from-right.
- a scrim `DialogOverlay`, a header with title + an `X` close (`aria-label="Close"`), and a
  scrollable body.

`@radix-ui/react-dialog` is added as a direct dependency of `apps/web` pinned to the version canopy
already resolves (it is transitively present today; a direct dep just makes the import first-class),
so this adds no new third-party surface.

`HelpSheet({ game })` looks up the game's rules + catalog how-to-play and renders `RulesContent`
inside `Sheet`. A `HelpButton` (a `?` glyph in `components/game/icons.tsx`, an accessible
`aria-label="How to play"`) is added to a slim toolbar at the top of `GameStage`, present for every
mode (viewer, interactive, remote) and every phase - so the rules are reachable "at any time",
including mid-round, without leaving the game. Opening the sheet does not pause or mutate game
state; it is pure client UI over the existing `game` id.

### Listing surfaces

- `/games` index becomes a thin Server Component that passes the public catalog + library meta to a
  new client `GamesBrowser`: a search input and a category filter (a native `<select>` styled with
  canopy's input recipe - a plain enum, per the learnings note preferring native selects over
  portalled Radix for testability), filtering the list client-side; each card shows its category +
  the first few tags as chips. Empty search state reads as intentional ("No games match").
- `/games/[slug]` feature page adds a "Rules" section (`RulesContent`) and renders category/tag
  chips next to the existing content categories (kept, they are a different axis and feed SEO/JSON-
  LD).
- Insider index (`InsiderHome`): each card gains a small "How to play" button (not the whole-card
  play link) that opens a `Sheet` with the game's `RulesContent`, so an insider reads the rules
  before starting.

### Tests

- Unit: library completeness + vocabulary validity; `searchLibrary` (name hit, tag hit, category
  filter, no-match); `RulesContent` renders objective + all section headings; `Sheet` opens on
  trigger, closes on Escape/close button, sets `role="dialog"`/`aria-modal`; `HelpButton` in
  `GameStage` opens the sheet; `GamesBrowser` filters by query and category.
- e2e: in an existing game, tap the help icon, assert the rules sheet shows the objective, close it,
  game still live; on `/games`, type a query and assert the list narrows. Runs at the 360px phone
  viewport per rule 1.

## Acceptance

- [ ] `library.ts` exports the category/tag vocabularies, `GameRules`/`GameLibraryEntry` shapes, a
      `GAME_LIBRARY` with entries for `trivia`, `liar-liar`, `teeter-tower`, and search/lookup
      helpers; a unit test fails if any registered game lacks an entry or declares an unknown
      category/tag.
- [ ] The `/games` index shows category + tag chips on each card and narrows via a search box and a
      category filter; a no-match state renders.
- [ ] The `/games/[slug]` feature page renders a full Rules section (objective + sections) and the
      category/tag chips.
- [ ] Every in-game screen (viewer, interactive, remote; any phase) shows a help icon that opens a
      sheet - up from the bottom at 360px, in from the right on desktop - showing that game's rules,
      dismissible by backdrop, close button, and Escape, without ending or pausing the game.
- [ ] The insider index exposes each game's rules via a "How to play" trigger opening the same
      rules content.
- [ ] `RulesContent` is the single renderer shared by the feature page, the help sheet, and the
      insider card.
- [ ] Unit + e2e tests above pass; `pnpm build`, lint, typecheck, and the test suites are green;
      everything is usable at ~360px.
