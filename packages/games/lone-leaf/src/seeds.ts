// Lone Leaf seed bank: the data contract, loader, and structural validator (spec 0057). A seed is one
// mystery word the Seeker must guess from the surviving leaves. The public repo ships a small SAMPLE
// under data/lone-leaf/*.json; the full bank would later live in the private data repo mounted at
// GAME_DATA_DIR (spec 0041). `validateSeedBank` checks per-item STRUCTURE only (schema, id
// format + uniqueness, a non-empty word, an optional 1-10 difficulty, no duplicate word in a
// category) - there is no per-category count gate, because the bank grows over time and its category
// spread is deliberately uneven.
//
// Words may be a SINGLE word (the original six themes) or MULTIPLE words for the proper-noun themes
// added in the difficulty rework (famous people, movies, historical figures) - e.g. "albert einstein".
// Matching (matching.ts) normalizes case and collapses internal whitespace so a Seeker's guess still
// resolves regardless of spacing/case. `difficulty` is an OPTIONAL obscurity rating (1 = universally
// known, 10 = obscure): the code treats a missing value as {@link DEFAULT_DIFFICULTY}, so seeds
// without it still load - this decouples the engine from the data, which fills the ratings in.

import type { AssetLoader } from '@branchout/game-sdk';

/** One seed: the mystery word the Seeker guesses, tagged by theme, with an optional obscurity rating. */
export interface LoneLeafSeed {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The mystery word the non-Seekers write leaves for. One word, or several for proper-noun themes. */
  word: string;
  /** Extra accepted spellings of the word, so a correct guess is recognized robustly. */
  aliases?: string[];
  /** Obscurity rating 1-10 (1 = universally known, 10 = obscure). Optional; missing defaults to 5. */
  difficulty?: number;
}

/**
 * The seed categories a host may choose from (1-3, or `random` across all). The first six are the
 * single-word themes; `celebrities`/`movies`/`historical` are the proper-noun themes (multi-word
 * words allowed) added by the difficulty rework. Slugs are the wire contract shared with the web
 * mirror and the private data repo, so they must not drift.
 */
export const CATEGORIES = [
  'nature',
  'everyday',
  'places',
  'food',
  'animals',
  'feelings',
  'celebrities',
  'movies',
  'historical',
] as const;

export type LoneLeafCategory = (typeof CATEGORIES)[number];

/** Difficulty bounds (obscurity), shared with the host config's band. Mirrors Trivia's 1-10 scale. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
/** A seed with no explicit rating is treated as mid-scale, so undated data still selects sensibly. */
export const DEFAULT_DIFFICULTY = 5;

/** The seed's effective obscurity rating: its `difficulty`, or {@link DEFAULT_DIFFICULTY} when absent. */
export function seedDifficulty(seed: LoneLeafSeed): number {
  return seed.difficulty ?? DEFAULT_DIFFICULTY;
}

/** Id convention: `<category>-NNN` (3-digit zero-padded suffix). */
const ID_PATTERN = /^[a-z]+-\d{3}$/;

/**
 * Read every category file (`data/lone-leaf/<category>.json`) through the injected loader and return
 * the flattened seed array. Rooted at this package via the asset loader, so it works from `src` under
 * tsx and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadSeedBank(assets: AssetLoader): Promise<LoneLeafSeed[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<LoneLeafSeed[]>(`data/lone-leaf/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`lone-leaf seed bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  return perCategory.flat();
}

/**
 * Validate the STRUCTURE of every seed in the bank. Runs at engine boot on any bank size (the public
 * sample or the full private bank). Throws a descriptive `Error` on the first violation. There is no
 * per-category count/coverage gate: the bank grows over time and its category spread is deliberately
 * uneven, so a bank of any size validates as long as each item is well-formed.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `<category>-NNN` (3-digit suffix).
 * 2. `category` is one of {@link CATEGORIES}.
 * 3. `word` is a non-empty string. One OR many words are allowed (multi-word proper nouns).
 * 4. `aliases` (optional) is an array of non-empty strings.
 * 5. `difficulty` (optional) is an integer in [1, 10] when present.
 * 6. No duplicate `word` within a single category (compared case-insensitively, whitespace-collapsed).
 */
export function validateSeedBank(seeds: readonly LoneLeafSeed[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  // Track words seen per category, so a duplicate word in the same category is caught.
  const wordsByCategory = new Map<string, Set<string>>();

  for (const seed of seeds) {
    const pos = `seed id=${JSON.stringify(seed.id)}`;

    if (typeof seed.id !== 'string' || seed.id.length === 0) {
      throw new Error(`lone-leaf seed bank: a seed has a missing or empty id`);
    }
    if (seen.has(seed.id)) {
      throw new Error(`lone-leaf seed bank: duplicate id "${seed.id}"`);
    }
    seen.add(seed.id);

    if (typeof seed.category !== 'string' || !categories.has(seed.category)) {
      throw new Error(
        `lone-leaf seed bank: ${pos} has category ${JSON.stringify(seed.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }

    // Id must follow the <category>-NNN convention (a static pattern plus a startsWith check, matching
    // the trivia/liar-liar validators) - category is pre-validated, and the static form removes the
    // injection footgun.
    if (!ID_PATTERN.test(seed.id) || !seed.id.startsWith(`${seed.category}-`)) {
      throw new Error(
        `lone-leaf seed bank: seed id "${seed.id}" must match ${seed.category}-NNN (3 digits)`,
      );
    }

    // The word may be one word or several (multi-word proper nouns for the celebrities/movies/
    // historical themes); only an empty/blank word is rejected. Matching collapses case + whitespace.
    if (typeof seed.word !== 'string' || seed.word.trim().length === 0) {
      throw new Error(`lone-leaf seed bank: ${pos} has an empty word`);
    }
    if (seed.aliases !== undefined) {
      if (
        !Array.isArray(seed.aliases) ||
        seed.aliases.some((a) => typeof a !== 'string' || a.length === 0)
      ) {
        throw new Error(
          `lone-leaf seed bank: ${pos} aliases must be an array of non-empty strings`,
        );
      }
    }
    // Difficulty is optional (missing -> DEFAULT_DIFFICULTY at read time); when present it must be an
    // integer inside the supported 1-10 obscurity scale, so a malformed rating fails fast at boot.
    if (seed.difficulty !== undefined) {
      if (
        typeof seed.difficulty !== 'number' ||
        !Number.isInteger(seed.difficulty) ||
        seed.difficulty < MIN_DIFFICULTY ||
        seed.difficulty > MAX_DIFFICULTY
      ) {
        throw new Error(
          `lone-leaf seed bank: ${pos} difficulty must be an integer ${MIN_DIFFICULTY}-${MAX_DIFFICULTY}, ` +
            `got ${JSON.stringify(seed.difficulty)}`,
        );
      }
    }

    // No duplicate words within a category. Collapse internal whitespace so a multi-word seed compares
    // by its canonical spacing ("albert  einstein" == "albert einstein").
    let seenWords = wordsByCategory.get(seed.category);
    if (!seenWords) {
      seenWords = new Set<string>();
      wordsByCategory.set(seed.category, seenWords);
    }
    const normalized = seed.word.trim().replace(/\s+/g, ' ').toLowerCase();
    if (seenWords.has(normalized)) {
      throw new Error(
        `lone-leaf seed bank: duplicate word in category "${seed.category}": "${seed.word}"`,
      );
    }
    seenWords.add(normalized);
  }
}
