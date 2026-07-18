# 0065 - One game card: a single configurable component for every surface

## Problem

A game is rendered as a "card" in at least four different ways, and they have drifted:

- **Home teaser** (`LandingContent` -> `GameListCard`): a wide hero, mark + name, a marketing badge, a
  one-line summary, a `categories.join(', ')` string, the whole card an `<a>` to the feature page,
  plus a *separate* "Play now" link appended below for signed-in viewers.
- **`/games` index** (`GamesBrowser`, a bespoke inline card): no hero, the mark, name, summary,
  category + tag chips, "Learn more" - hand-rolled, does not reuse `GameListCard`.
- **Insider landing** (`InsiderHome` -> `GameListCard`): the closest to what we want - hero, icon +
  title, an Insider badge, summary, and a footer with a "Play now" link and a "How to play" sheet
  trigger.
- **Lobby / room picker** (`GameCard`): mark, name, tagline, summary, no hero/badge/chips, and it
  doubles as a selectable `<button aria-pressed>` in the picker.

Four renders, three data reads (registry, catalog, library), two shared components plus two bespoke
inline cards. Adding a game or tweaking the card means editing several places, and the surfaces look
and behave inconsistently. We want **one configurable game card** used everywhere.

## Outcome

- A single `GameCard` component renders a game consistently on the home teaser, the `/games` index,
  the insider landing, and the lobby/room picker. The `GameListCard` + old `GameCard` + the two
  bespoke inline cards are all replaced by it.
- The card, modelled on the insider landing card (the best current version), shows top to bottom:
  - a **hero image** (the game's 16:9 hero art, `GAME_HERO[slug]`, falling back to the mark),
  - the **game icon (mark) + title inline**,
  - directly under the title, an **optional badge** (New, Popular, Insider-defined, etc.). The
    game's **tags** stay in the card's data (`GameCardData`, feeding the `/games` search and the game
    page) but are **not rendered on the card** - a row of tag pills read as clutter, so the card
    keeps only the single badge (revision 2026-07-18, front-door polish),
  - a **brief description**,
  - a **"Play now" button**,
  - a **"Details" link** (this replaces the old "How to play" trigger) that navigates to the game's
    page (`/games/[slug]`, spec `0030`).
- **Configurable affordances:** the "Play now" button and the "Details" link can each be hidden. The
  lobby/picker uses the card with **both hidden** (and in its selectable variant).
- **Insiders-only games** show an extra **"Insiders" badge in the top-right of the card, beside the
  title**, in addition to the normal badge/tags row.
- The card is mobile-first: it reads and taps well at ~360px and scales up cleanly, and it exposes a
  single accessible action per interactive element (no link nested inside a link).
- Covered by tests: the configurable show/hide of each affordance, the badge + tags render, the
  insiders badge on an insider game, the selectable picker variant, and a 360px render guard.

## Scope

**In**

- A new `components/game/GameCard.tsx` (replacing the current `GameCard` and `GameListCard`) with a
  props contract roughly:
  - `game` - the display data (slug, name, icon/mark, description, hero, tags, badge, `insider`),
    resolved from one place (see Approach) so a caller passes a slug or a resolved entry, not four
    separate reads.
  - `showPlay?: boolean` (default true) - render the "Play now" button; `playHref` supplied or
    derived (`playHref(slug)`).
  - `showDetails?: boolean` (default true) - render the "Details" link to `featurePath(slug)`.
  - `onSelect?` / `selected?` / `disabled?` - the selectable picker variant (mutually exclusive with
    the Play/Details buttons; when `onSelect` is set the card is a pressable control and both
    affordances are off).
  - `badge?` override and `href?` for the whole-card link when neither affordance is shown but the
    card should still navigate (home/`/games` "learn more" behavior folds into the Details link now).
- **One display-data reader.** A small helper (co-located with the registry/catalog, e.g.
  `getGameCard(slug)` or a `GameCardData` assembled in `catalog.ts`) that merges the registry basics
  (name, mark, summary), the catalog badge, the library tags, and the hero art into the single shape
  the card consumes - so adding a game stays "add a module + a catalog/library entry".
- **Replace all four render sites** with the new card, passing the right flags:
  - Home teaser (`LandingContent`): Play + Details shown; drop the separate appended "Play now" link.
  - `/games` index (`GamesBrowser`): Play + Details shown; the search/filter controls stay.
  - Insider landing (`InsiderHome`): Play + Details shown (Details now goes to the game's insider
    page, spec `0030`); the standalone `HowToPlayButton` on the card is removed (rules live on the
    game page now). Insiders badge shows.
  - Lobby/picker (`GamePicker`, `Lobby`): `showPlay={false} showDetails={false}`, selectable in the
    picker, read-only in the lobby's "Your game" panel.
- Unit tests for the card variants and a 360px e2e/render check; keep the existing `/games` search
  and picker-selection tests green (ported to the new card).

**Out**

- The **game feature page** at `/games/[slug]` itself (its hero, sections, and the insider per-game
  pages) - spec `0030` owns the page; this spec only links to it via Details.
- The **start-a-game behavior** behind "Play now" (skip the create-room step) - spec `0029`.
- The `Chip`, `RulesContent`, `Sheet`, and `HowToPlayButton` components (still used on the game page
  and in-game); only the card's *use* of `HowToPlayButton` is removed.
- New hero art for games that lack it (they fall back to the mark).
- Changing the taxonomy/badge vocabularies (`library.ts`, `catalog.ts`) - reused as-is.

## Approach

- **Model the insider card, generalize its footer.** The insider `GameListCard` already nails the
  hero + icon/title + badge + summary + footer shape. Lift it into the new `GameCard`, turn the
  footer into the configurable Play/Details row, and add the badge+tags row under the title and the
  top-right Insiders badge.
- **Buttons vs. selectable, never both.** The picker needs a pressable card (`aria-pressed`,
  selection ring); the listing surfaces need a card with two independent actions. These are mutually
  exclusive: when `onSelect` is present the card is the control and affordances are off; otherwise the
  affordances render. This avoids a link-in-a-link and keeps one accessible action per element (the
  learnings note on "card as a link").
- **One data read.** The card takes a resolved `GameCardData` so each surface does one lookup, not
  three. Keep it colocated with the registry/catalog seam so the "add a module + entry" ergonomics
  hold and nothing drifts across surfaces again.
- **Details replaces How-to-play.** The card no longer hosts a rules sheet; "Details" navigates to
  the game page, where the rules now live (spec `0030`). This removes the last bespoke card behavior
  (the insider `HowToPlayButton`) and unifies the two listing surfaces.
- **Mobile-first, ASCII-only, on-brand voice.** The hero box owns its own 16:9 sizing so nothing
  leaks past the card at 360px (the content-bearing-card overflow learning). The badge/tags row wraps.

## Acceptance

- [ ] A single `GameCard` renders the home teaser, `/games` index, insider landing, and lobby/picker;
      `GameListCard` and the two bespoke inline card renders are gone.
- [ ] The card shows a hero, icon + title inline, an optional badge beneath the title (tags are kept
      in `GameCardData` but not rendered on the card), a brief description, a "Play now" button, and a
      "Details" link to `/games/[slug]`.
- [ ] `showPlay` and `showDetails` each hide their affordance; the lobby/picker renders the card with
      both hidden, selectable in the picker (`aria-pressed`, selection ring) and read-only in the
      lobby.
- [ ] An insider game shows an extra "Insiders" badge in the card's top-right beside the title.
- [ ] All card display data comes from one resolved shape; adding a game needs no per-surface card
      edit.
- [ ] The card reads and taps well at 360px; no nested interactive controls (one accessible action
      per element).
- [ ] Unit tests cover the show/hide flags, the badge (and that tags are NOT rendered on the card),
      the insiders badge, and the picker
      selectable variant; the `/games` search/filter and picker-selection behaviors stay covered; a
      360px render guard passes. `pnpm build`, lint, typecheck, and tests are green.
