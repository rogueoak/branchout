// Lone Leaf seed bank: the data contract, loader, and structural validator (spec 0057). A seed is one
// mystery word the Seeker must guess from the surviving leaves. The public repo ships a small SAMPLE
// under data/lone-leaf/*.json; the full bank would later live in the private data repo mounted at
// GAME_DATA_DIR (spec 0041). `validateSeedBank` checks per-item STRUCTURE only (schema, id
// format + uniqueness, single-word seeds, no duplicate word in a category) - there is no per-category
// count gate, because the bank grows over time and its category spread is deliberately uneven.

import type { AssetLoader } from '@branchout/game-sdk';

/** One seed: the mystery word the Seeker guesses, tagged by theme. */
export interface LoneLeafSeed {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The mystery word (a single word) the non-Seekers write leaves for. */
  word: string;
  /** Extra accepted spellings of the word, so a correct guess is recognized robustly. */
  aliases?: string[];
}

/** The seed categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = ['nature', 'everyday', 'places', 'food', 'animals', 'feelings'] as const;

export type LoneLeafCategory = (typeof CATEGORIES)[number];

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
 * 3. `word` is a non-empty single word (no inner whitespace).
 * 4. `aliases` (optional) is an array of non-empty strings.
 * 5. No duplicate `word` within a single category.
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

    // Id must follow the <category>-NNN convention (3-digit zero-padded suffix). A static pattern plus
    // a startsWith check (matching the trivia/liar-liar validators) - category is pre-validated, and
    // the static form removes the injection footgun.
    const idPattern = /^[a-z]+-\d{3}$/;
    if (!idPattern.test(seed.id) || !seed.id.startsWith(`${seed.category}-`)) {
      throw new Error(
        `lone-leaf seed bank: seed id "${seed.id}" must match ${seed.category}-NNN (3 digits)`,
      );
    }

    if (typeof seed.word !== 'string' || seed.word.trim().length === 0) {
      throw new Error(`lone-leaf seed bank: ${pos} has an empty word`);
    }
    if (seed.word.trim().includes(' ')) {
      throw new Error(`lone-leaf seed bank: ${pos} word "${seed.word}" must be a single word`);
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

    // No duplicate words within a category.
    let seenWords = wordsByCategory.get(seed.category);
    if (!seenWords) {
      seenWords = new Set<string>();
      wordsByCategory.set(seed.category, seenWords);
    }
    const normalized = seed.word.trim().toLowerCase();
    if (seenWords.has(normalized)) {
      throw new Error(
        `lone-leaf seed bank: duplicate word in category "${seed.category}": "${seed.word}"`,
      );
    }
    seenWords.add(normalized);
  }
}
