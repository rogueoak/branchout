'use client';

// The client-side browser for the /games index (spec 0051): a search input and a native category
// filter narrow the server-rendered game list client-side, and each card shows its category + tag
// chips. The server page passes the public catalog + per-game meta down (no client data fetch); this
// component owns only the query/category state and the filtered render. A native `<select>` (styled
// with the canopy input recipe) is used over a portalled Radix select per the learnings note - it is
// testable and needs no portal. A no-match state reads as intentional, not broken.

import { Input, Label, inputVariants } from '@rogueoak/canopy';
import { useMemo, useState } from 'react';
import { startGameHref, type GameCardData } from '../../lib/games/catalog';
import { categoriesInUse, searchLibrary, type GameCategory } from '../../lib/games/library';
import { GameCard } from './GameCard';

interface GamesBrowserProps {
  /** The public games to list, as resolved card data (one lookup per game, spec 0065). */
  games: readonly GameCardData[];
  /** Whether the viewer is signed in, so each card's "Play now" routes anon visitors via signup. */
  signedIn: boolean;
}

export function GamesBrowser({ games, signedIn }: GamesBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameCategory | ''>('');

  // Only offer categories some listed game actually declares (nothing to match otherwise).
  const categoryOptions = useMemo(() => categoriesInUse(games), [games]);

  // Seed the placeholder with a term that actually matches something today, so following the hint
  // never lands on the empty state: an in-use category label (lower-cased) if any, else a game name.
  const exampleTerm = categoryOptions[0]?.label.toLowerCase() ?? games[0]?.name.toLowerCase();
  const searchPlaceholder = exampleTerm
    ? `Try '${exampleTerm}', 'bluffing', or a game name`
    : 'Search by name, category, or tag';

  const visible = useMemo(() => {
    const slugs = new Set(searchLibrary(games, query, category ? { category } : {}));
    return games.filter((game) => slugs.has(game.slug));
  }, [games, query, category]);

  return (
    <div className="flex flex-col gap-8">
      {/* Controls: a search box and a category filter, using canopy's input recipe (Input/Label +
          a native <select className={inputVariants()}>) so radius/padding/focus-ring match every
          other form control (the house pattern TriviaConfigPanel sets). Stack on a phone, inline from
          sm up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="games-search">Search games</Label>
          <Input
            id="games-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-52">
          <Label htmlFor="games-category">Category</Label>
          <select
            id="games-category"
            className={inputVariants()}
            value={category}
            onChange={(event) => setCategory(event.target.value as GameCategory | '')}
          >
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* A polite, visually-hidden live region announcing the match count whenever the query/filter
          narrows the list (a sighted user sees the grid shrink; a screen-reader user hears the count).
          The visible no-match message below still carries the empty case on screen. */}
      <p role="status" aria-live="polite" className="sr-only">
        {visible.length === 1 ? '1 game matches.' : `${visible.length} games match.`}
      </p>

      {visible.length === 0 ? (
        // The empty state reads as intentional (a query that matched nothing), not a broken page.
        <p className="text-body text-text-muted py-8 text-center">
          No games match. Try a different search or category.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2" role="list">
          {visible.map((game) => (
            <li key={game.slug}>
              {/* The one unified game card (spec 0065): hero, mark + title, badge + tags, summary, and
                  the Play/Details row. "Play now" routes an anonymous visitor through signup first. */}
              <GameCard game={game} playHref={startGameHref(game.slug, signedIn)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
