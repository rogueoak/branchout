// The game library (spec 0051): the taxonomy and rules layer over the registry. A registry module
// says how a game renders; its marketing catalog entry sells it; this library entry organizes it - a
// game's categories (broad genre), tags (facets), and a structured rules overview. One controlled
// vocabulary and one `GAME_LIBRARY` record, keyed by slug (== registry id), so the /games index can
// search + filter, the feature page can render full rules, and the in-game help sheet can read the
// same rules while playing. Pure data + pure helpers, server- AND client-safe (no server-only
// imports) so the client help sheet imports it directly. Adding a game must add a library entry -
// `toLibrary` fails loudly, the same pattern the marketing catalog already uses.

import { GAME_UI_LIST, type GameUiModule } from './registry';

/**
 * The broad genre vocabulary: 1+ per game, the first is primary. Keys are slugs (stored on entries
 * and in URLs); values are the display labels shown as chips and in the filter control.
 */
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

/** The facet vocabulary: finer than a category (team play, group size, pace, the twist). */
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

/** One headed block of the rules: a title plus one or more short paragraphs. */
export interface RulesSection {
  heading: string; // "Setup", "On your turn", "Scoring", "Good to know"
  body: string[]; // paragraphs; a section is one or more short paragraphs
}

/** A game's structured rules: the one-sentence objective plus headed sections. */
export interface GameRules {
  objective: string; // one sentence: how you win
  sections: RulesSection[];
}

/** A game's library entry: its taxonomy (categories, tags) and its rules overview. */
export interface GameLibraryEntry {
  categories: GameCategory[]; // 1+, first is primary
  tags: GameTag[];
  rules: GameRules;
}

// Keyed by slug (== registry id). Adding a game means adding its registry module AND one entry here;
// `toLibrary` throws below if a registered game has no entry. Categories/tags use vocabulary keys, so
// a typo fails the completeness test (data can come from spreads TypeScript cannot fully police).
const GAME_LIBRARY: Record<string, GameLibraryEntry> = {
  trivia: {
    categories: ['party'],
    tags: ['trivia', 'real-time', 'big-group', 'wit'],
    rules: {
      objective: 'Score the most points by answering questions correctly across the rounds.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host picks the categories, a difficulty range, and how many rounds to play, then ' +
              'shares the join code. Everyone joins on their own phone.',
          ],
        },
        {
          heading: 'On each round',
          body: [
            'A question appears for everyone at once. Type your answer in your own words before the ' +
              '60-second timer runs out - there is no multiple choice.',
          ],
        },
        {
          heading: 'Reveal and dispute',
          body: [
            'Answers reveal together and a correct one scores 100 points. If you were marked wrong ' +
              'but think you were right, dispute it in the short window and the group votes to settle ' +
              'it. Winning the vote scores 50.',
          ],
        },
        {
          heading: 'Good to know',
          body: [
            'Close calls end on the scoreboard, not in an argument. The highest total after the last ' +
              'round wins.',
          ],
        },
      ],
    },
  },
  'liar-liar': {
    categories: ['party', 'deduction'],
    tags: ['bluffing', 'deduction', 'wit', 'big-group', 'real-time'],
    rules: {
      objective: 'Score the most by fooling other players with your fake and by finding the truth.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host sets the number of rounds and shares the join code. Everyone plays on their ' +
              'own phone.',
          ],
        },
        {
          heading: 'Write a lie',
          body: [
            'A wild-but-true clue appears with the answer blanked out. Invent a fake answer ' +
              'convincing enough to fool the room before the 90-second timer ends. A fake that ' +
              'matches the truth or another player is quietly rejected, so try again.',
          ],
        },
        {
          heading: 'Find the truth',
          body: [
            'Every fake plus the real answer appears, shuffled. Pick the one you think is true ' +
              'before the 30-second guess timer runs out.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'Guessing the real answer scores 100. Each player your fake fools scores you 50. The ' +
              'highest total after the last round wins.',
          ],
        },
      ],
    },
  },
  'teeter-tower': {
    categories: ['strategy'],
    tags: ['spatial', 'real-time', 'quick'],
    rules: {
      objective: 'Stack pieces to reach the target line on each level without toppling the tower.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Teeter Tower is a single-surface game you play on one screen. There are three levels: a ' +
              'warm-up, a taller walled climb, and a swinging pendulum.',
          ],
        },
        {
          heading: 'Spin and lock',
          body: [
            'A googly-eyed piece spins on the board. Tap or drag to position it, then tap the ' +
              'on-canvas Stop spin button to lock the angle you want it to drop at.',
          ],
        },
        {
          heading: 'Aim and drop',
          body: [
            'Drag to fine-tune where the piece sits over the tower, then tap Drop and watch the ' +
              'physics settle it onto the stack.',
          ],
        },
        {
          heading: 'Reach the line',
          body: [
            'Stack piece on piece until the tower reaches the target line to clear the level. Keep ' +
              'the stack balanced - a piece that slides off is lost.',
          ],
        },
      ],
    },
  },
};

/**
 * Resolve a registered game's library entry, or throw. Fail loudly: a registered game with no
 * library entry would ship a broken feature page (no rules) and break the completeness test, so
 * adding a game must add its entry here (mirrors `toEntry` in catalog.ts).
 */
export function toLibrary(module: GameUiModule): GameLibraryEntry {
  const entry = GAME_LIBRARY[module.id];
  if (!entry) {
    throw new Error(`No library entry for game "${module.id}" - add one to lib/games/library.ts`);
  }
  return entry;
}

/** The library entry for a slug, or undefined for an unknown game. */
export function getLibraryEntry(slug: string | undefined | null): GameLibraryEntry | undefined {
  return slug ? GAME_LIBRARY[slug] : undefined;
}

/** The rules overview for a slug, or undefined for an unknown game. */
export function getGameRules(slug: string | undefined | null): GameRules | undefined {
  return getLibraryEntry(slug)?.rules;
}

/** A category or tag resolved to its display label. */
export interface LibraryChip {
  slug: string;
  label: string;
}

/** A game's categories + tags with display labels, for chips on cards and pages. */
export interface LibraryMeta {
  categories: LibraryChip[];
  tags: LibraryChip[];
}

/** Categories + tags of a slug resolved to display labels, or undefined for an unknown game. */
export function getLibraryMeta(slug: string | undefined | null): LibraryMeta | undefined {
  const entry = getLibraryEntry(slug);
  if (!entry) return undefined;
  return {
    categories: entry.categories.map((slug) => ({ slug, label: GAME_CATEGORIES[slug] })),
    tags: entry.tags.map((slug) => ({ slug, label: GAME_TAGS[slug] })),
  };
}

/** A game the search surfaces over: the slug + the free-text fields matched against. */
export interface SearchableGame {
  slug: string;
  name: string;
  summary: string;
}

/** Filters for {@link searchLibrary}: an optional category the game must declare. */
export interface SearchOptions {
  category?: GameCategory;
}

/**
 * Search a set of games by a free-text query (case-insensitive substring over name, summary, and tag
 * labels) and an optional category filter. Returns the matching slugs, preserving input order. An
 * empty query matches everything (the filter still applies), so the /games index can pass the query
 * straight through as the visitor types.
 */
export function searchLibrary(
  games: readonly SearchableGame[],
  query: string,
  options: SearchOptions = {},
): string[] {
  const q = query.trim().toLowerCase();
  const { category } = options;
  return games
    .filter((game) => {
      const entry = GAME_LIBRARY[game.slug];
      if (!entry) return false;
      if (category && !entry.categories.includes(category)) return false;
      if (!q) return true;
      const haystack = [
        game.name,
        game.summary,
        ...entry.tags.map((tag) => GAME_TAGS[tag]),
        ...entry.categories.map((cat) => GAME_CATEGORIES[cat]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .map((game) => game.slug);
}

/**
 * The categories some game in the given set actually declares, in vocabulary order, with labels -
 * the options for the /games filter control (only offer a filter that would match something).
 */
export function categoriesInUse(games: readonly SearchableGame[]): LibraryChip[] {
  const used = new Set<GameCategory>();
  for (const game of games) {
    const entry = GAME_LIBRARY[game.slug];
    if (!entry) continue;
    for (const category of entry.categories) used.add(category);
  }
  return (Object.keys(GAME_CATEGORIES) as GameCategory[])
    .filter((slug) => used.has(slug))
    .map((slug) => ({ slug, label: GAME_CATEGORIES[slug] }));
}

/**
 * Every registered game's library entry, resolved via `toLibrary` so the build fails loudly if any
 * registered game lacks an entry (the completeness guard the spec's test asserts).
 */
export const GAME_LIBRARY_ENTRIES: ReadonlyMap<string, GameLibraryEntry> = new Map(
  GAME_UI_LIST.map((module) => [module.id, toLibrary(module)]),
);
