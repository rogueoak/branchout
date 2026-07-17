// Sketchy seed bank: the data contract, loader, and validator (spec 0063). A seed is a short,
// drawable prompt (the thing a player secretly draws). The shape and loader follow the spec 0041
// pattern: the public repo ships a small SAMPLE under data/sketchy/*.json; the full bank would live
// in the private data repo mounted at GAME_DATA_DIR. `validateSeedBank` checks per-item STRUCTURE
// only (schema, id format + uniqueness, no duplicate text in a category) - there is no per-category
// count gate, because the bank grows over time and its category spread is deliberately uneven.

import type { AssetLoader } from '@branchout/game-sdk';

/** One seed: a short drawable prompt in a themed category. */
export interface SketchySeed {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The prompt a player draws (kept short + concrete so it is drawable). */
  text: string;
}

/** The seed categories bundled in the sample bank. */
export const CATEGORIES = ['animals', 'objects', 'food', 'nature', 'actions', 'places'] as const;

export type SketchyCategory = (typeof CATEGORIES)[number];

/**
 * Read every category file (`data/sketchy/<category>.json`) through the injected loader and return the
 * flattened seed array. Rooted at this package via the asset loader, so it works from `src` under tsx
 * and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadSeedBank(assets: AssetLoader): Promise<SketchySeed[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<SketchySeed[]>(`data/sketchy/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`sketchy seed bank: ${category}.json must be a JSON array`);
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
 * 3. `text` is a non-empty string.
 * 4. No duplicate `text` prompt within a single category.
 */
export function validateSeedBank(seeds: readonly SketchySeed[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  const textsByCategory = new Map<string, Set<string>>();
  const idPattern = /^[a-z]+-\d{3}$/;

  for (const seed of seeds) {
    const pos = `seed id=${JSON.stringify(seed.id)}`;

    if (typeof seed.id !== 'string' || seed.id.length === 0) {
      throw new Error(`sketchy seed bank: a seed has a missing or empty id`);
    }
    if (seen.has(seed.id)) {
      throw new Error(`sketchy seed bank: duplicate id "${seed.id}"`);
    }
    seen.add(seed.id);

    if (typeof seed.category !== 'string' || !categories.has(seed.category)) {
      throw new Error(
        `sketchy seed bank: ${pos} has category ${JSON.stringify(seed.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }

    // Id must follow the <category>-NNN convention (3-digit zero-padded suffix). Static pattern +
    // startsWith check (category is pre-validated), matching the Liar Liar/Trivia validators.
    if (!idPattern.test(seed.id) || !seed.id.startsWith(`${seed.category}-`)) {
      throw new Error(
        `sketchy seed bank: seed id "${seed.id}" must match ${seed.category}-NNN (3 digits)`,
      );
    }

    if (typeof seed.text !== 'string' || seed.text.trim().length === 0) {
      throw new Error(`sketchy seed bank: ${pos} has an empty text`);
    }

    let seenTexts = textsByCategory.get(seed.category);
    if (!seenTexts) {
      seenTexts = new Set<string>();
      textsByCategory.set(seed.category, seenTexts);
    }
    const normalized = seed.text.trim().toLowerCase();
    if (seenTexts.has(normalized)) {
      throw new Error(
        `sketchy seed bank: duplicate prompt in category "${seed.category}": "${seed.text}"`,
      );
    }
    seenTexts.add(normalized);
  }
}
