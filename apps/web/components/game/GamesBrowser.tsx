'use client';

// The client-side browser for the /games index (spec 0051): a search input and a native category
// filter narrow the server-rendered game list client-side, and each card shows its category + tag
// chips. The server page passes the public catalog + per-game meta down (no client data fetch); this
// component owns only the query/category state and the filtered render. A native `<select>` (styled
// with the canopy input recipe) is used over a portalled Radix select per the learnings note - it is
// testable and needs no portal. A no-match state reads as intentional, not broken.

import { Input, Label, inputVariants } from '@rogueoak/canopy';
import { useMemo, useState } from 'react';
import {
  categoriesInUse,
  searchLibrary,
  type GameCategory,
  type LibraryChip,
} from '../../lib/games/library';
import { Chip } from './Chip';

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
                    <Chip key={`c-${chip.slug}`} variant="category">
                      {chip.label}
                    </Chip>
                  ))}
                  {game.tags.slice(0, 3).map((chip) => (
                    <Chip key={`t-${chip.slug}`} variant="tag">
                      {chip.label}
                    </Chip>
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
