# Plan 0065 - One unified game card

Build plan for spec [`0065-unified-game-card`](../specs/0065-unified-game-card.md): consolidate the
four divergent game-card renders into one configurable `GameCard`, fed by one display-data reader.

## Approach

Model the insider landing card (the best prior version), generalize its footer into a configurable
Play/Details row, add the badge+tags row and the top-right Insiders badge, and route every surface
through one resolved `GameCardData` shape so the four surfaces cannot drift again.

## Ordered steps

1. **One data reader.** Add `GameCardData` + `getGameCard(slug)` to `apps/web/lib/games/catalog.ts`.
   It merges the registry basics (name, mark, summary), the catalog badge, the library tags
   (`getLibraryMeta`), the hero art (`GAME_HERO ?? mark`), and the insider flag into the single shape
   the card consumes. Uses the full registry (not the public catalog) so the insider landing can
   resolve insider-only games. No import cycle: `library.ts` and `heroes.ts` do not import `catalog.ts`.
2. **The unified card.** Rewrite `apps/web/components/game/GameCard.tsx` as the one card: 16:9 hero,
   mark + title inline with the Insiders badge pinned right, a badge + tags row under the title, the
   summary, and a configurable Play/Details footer. Props contract:
   - `game: GameCardData`, `showPlay?` (default true), `showDetails?` (default true),
     `playHref?` (default `playHref(slug)`), `onSelect?`/`selected?`/`disabled?`, `badge?`, `href?`.
   - Buttons vs. selectable, never both: when `onSelect` is set the whole card is a pressable control
     (`aria-pressed`, selection ring) and both affordances are forced off - no link nested in a link.
   - Details links to `featurePath(slug)`; the old How-to-play trigger is gone from the card.
3. **Replace the four render sites**, each with one `getGameCard` lookup:
   - Home teaser `components/LandingContent.tsx` - Play + Details shown; Play uses
     `startGameHref(slug, signedIn)` (anon -> signup). Dropped the separate appended Play link and the
     "Learn more" affordance.
   - `/games` index `components/game/GamesBrowser.tsx` + `app/games/page.tsx` - the browser now takes
     `GameCardData[]` + `signedIn` and renders the card; the search box + native category filter stay.
   - Insider landing `app/insider/InsiderHome.tsx` - Play + Details shown; the standalone
     `HowToPlayButton` is removed from the card; the Insiders badge shows.
   - Lobby/picker `components/game/GamePicker.tsx` (selectable) and `components/game/Lobby.tsx`
     (read-only) - both use `showPlay={false} showDetails={false}`.
4. **Remove the dead card.** Delete `GameListCard.tsx` + its test; update the stale `heroes.ts` comment.
5. **Tests.** Rewrite `GameCard.test.tsx` for the new contract (badge+tags, show/hide of each
   affordance, Insiders badge, selectable variant, a 360px render guard). Port `GamesBrowser.test.tsx`
   to `GameCardData` fixtures and the Play/Details affordances (search + filter kept). Update the home
   (`app/page.test.tsx`) and insider (`InsiderHome.test.tsx`) tests to the unified card. `GamePicker`
   selection tests carry over unchanged.

## Files touched

- `apps/web/lib/games/catalog.ts` - add `GameCardData` + `getGameCard`; import `heroes`/`library`.
- `apps/web/components/game/GameCard.tsx` - rewritten as the unified card.
- `apps/web/components/game/GameListCard.tsx` + `.test.tsx` - deleted.
- `apps/web/components/LandingContent.tsx`, `components/game/GamesBrowser.tsx`, `app/games/page.tsx`,
  `app/insider/InsiderHome.tsx`, `components/game/GamePicker.tsx`, `components/game/Lobby.tsx` - render
  sites swapped to the unified card.
- `apps/web/lib/games/heroes.ts` - comment updated.
- Tests: `GameCard.test.tsx`, `GamesBrowser.test.tsx`, `app/page.test.tsx`, `InsiderHome.test.tsx`.
- Docs: `docs/overview/features.md` (landing / `/games` / insider bullets).

## Verification

- `pnpm --filter @branchout/web lint` - clean.
- `pnpm --filter @branchout/web test` - 713 passed (113 files).
- `pnpm --filter @branchout/web build` - green (Next production build).
- Mobile-first: the hero box owns its 16:9 sizing, the badge/tags row wraps, the title is
  `min-w-0 break-words`, and the selectable control avoids the `whitespace-nowrap` button recipe - all
  guarded by the 360px render test.
