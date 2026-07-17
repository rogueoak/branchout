'use client';

// The client-side browser for the /games index (spec 0051): a search input and a native category
// filter narrow the server-rendered game list client-side, and each card shows its category + tag
// chips. The server page passes the public catalog + per-game meta down (no client data fetch); this
// component owns only the query/category state and the filtered render. A native `<select>` (styled
// with the canopy input recipe) is used over a portalled Radix select per the learnings note - it is
// testable and needs no portal. A no-match state reads as intentional, not broken.

import { useMemo, useState } from 'react';
import {
  categoriesInUse,
  searchLibrary,
  type GameCategory,
  type LibraryChip,
} from '../../lib/games/library';

/** One game the browser lists: display basics + its resolved category/tag chips + its feature path. */
export interface BrowserGame {
  slug: string;
  name: string;
  summary: string;
  icon: string;
  href: string;
  categories: LibraryChip[];
  tags: LibraryChip[];
}

interface GamesBrowserProps {
  games: readonly BrowserGame[];
}

export function GamesBrowser({ games }: GamesBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameCategory | ''>('');

  // Only offer categories some listed game actually declares (nothing to match otherwise).
  const categoryOptions = useMemo(() => categoriesInUse(games), [games]);

  const visible = useMemo(() => {
    const slugs = new Set(searchLibrary(games, query, category ? { category } : {}));
    return games.filter((game) => slugs.has(game.slug));
  }, [games, query, category]);

  return (
    <div className="flex flex-col gap-8">
      {/* Controls: a search box and a category filter. Stack on a phone, sit inline from sm up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="games-search" className="text-body-sm font-medium text-text">
            Search games
          </label>
          <input
            id="games-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try 'word', 'co-op', or a game name"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-52">
          <label htmlFor="games-category" className="text-body-sm font-medium text-text">
            Category
          </label>
          <select
            id="games-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as GameCategory | '')}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {visible.length === 0 ? (
        // The empty state reads as intentional (a query that matched nothing), not a broken page.
        <p role="status" className="text-body text-text-muted py-8 text-center">
          No games match. Try a different search or category.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2" role="list">
          {visible.map((game) => (
            <li key={game.slug}>
              {/* A descriptive accessible name per card - the visible "Learn more" text repeats across
                  cards (an a11y anti-pattern), so the link is labelled by the game it opens. */}
              <a
                href={game.href}
                aria-label={`Learn about ${game.name}`}
                className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-block h-12 w-12 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: game.icon }}
                  />
                  <h2 className="text-h4 text-text break-words">{game.name}</h2>
                </div>
                <p className="text-body-sm text-text-muted">{game.summary}</p>
                {/* Category + tag chips: the category first (primary genre), then the first few tags. */}
                <ul className="flex flex-wrap gap-2" role="list">
                  {game.categories.map((chip) => (
                    <li
                      key={`c-${chip.slug}`}
                      className="text-body-sm rounded-full bg-primary/10 px-3 py-1 font-medium text-primary"
                    >
                      {chip.label}
                    </li>
                  ))}
                  {game.tags.slice(0, 3).map((chip) => (
                    <li
                      key={`t-${chip.slug}`}
                      className="text-body-sm rounded-full bg-surface-raised px-3 py-1 text-text-muted"
                    >
                      {chip.label}
                    </li>
                  ))}
                </ul>
                <span className="text-body-sm mt-auto font-medium text-primary">Learn more</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
