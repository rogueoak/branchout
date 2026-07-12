// Liar Liar clue bank: the data contract, loader, and validator. A clue is an improbable-but-true
// statement with a genuine (surprising) answer; players invent fakes around it. The shape and loader
// are spec 0021; the seed content lives at data/liar-liar/*.json. The public repo ships a small
// SAMPLE; the full research-sourced bank is served from the private data repo mounted at
// GAME_DATA_DIR (see deploy/README.md). `validateClueBank` checks per-item STRUCTURE only (schema,
// id format + uniqueness, no duplicate prompt in a category) - there is no per-category count gate,
// because the bank grows over time and its category spread is deliberately uneven.

import type { AssetLoader } from '@branchout/game-sdk';

/** One clue: a describing statement and its true answer, plus any extra accepted spellings. */
export interface LiarLiarClue {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The improbable-but-true statement shown on the viewer. */
  clue: string;
  /** The real answer players must not submit and try to pick out. */
  answer: string;
  /** Extra accepted spellings of the answer, so the "cannot submit the truth" check is robust. */
  aliases?: string[];
  /** Provenance URL for the fact; carried in the data for review, ignored at runtime. */
  source?: string;
}

/** The eight clue categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = [
  'people',
  'places',
  'events',
  'sports',
  'food',
  'nature',
  'animals',
  'things',
] as const;

export type LiarLiarCategory = (typeof CATEGORIES)[number];

/**
 * Read every category file (`data/liar-liar/<category>.json`) through the injected loader and return
 * the flattened clue array. Rooted at this package via the asset loader, so it works from `src` under
 * tsx and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadClueBank(assets: AssetLoader): Promise<LiarLiarClue[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<LiarLiarClue[]>(`data/liar-liar/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`liar-liar clue bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  return perCategory.flat();
}

/**
 * Validate the STRUCTURE of every clue in the bank. Runs at engine boot on any bank size (the public
 * sample or the full private bank). Throws a descriptive `Error` on the first violation. There is no
 * per-category count/coverage gate: the bank grows over time and its category spread is deliberately
 * uneven, so a bank of any size validates as long as each item is well-formed.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `<category>-NNN` (3-digit suffix).
 * 2. `category` is one of {@link CATEGORIES}.
 * 3. `clue` and `answer` are non-empty strings.
 * 4. `aliases` (optional) is an array of non-empty strings; `source` (optional) is a non-empty string.
 * 5. No duplicate `clue` prompt within a single category.
 */
export function validateClueBank(clues: readonly LiarLiarClue[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  // Track prompts seen per category, so a duplicate prompt in the same category is caught.
  const promptsByCategory = new Map<string, Set<string>>();

  for (const clue of clues) {
    const pos = `clue id=${JSON.stringify(clue.id)}`;

    if (typeof clue.id !== 'string' || clue.id.length === 0) {
      throw new Error(`liar-liar clue bank: a clue has a missing or empty id`);
    }
    if (seen.has(clue.id)) {
      throw new Error(`liar-liar clue bank: duplicate id "${clue.id}"`);
    }
    seen.add(clue.id);

    if (typeof clue.category !== 'string' || !categories.has(clue.category)) {
      throw new Error(
        `liar-liar clue bank: ${pos} has category ${JSON.stringify(clue.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }

    // Id must follow the <category>-NNN convention (3-digit zero-padded suffix).
    const idPattern = new RegExp(`^${clue.category}-\\d{3}$`);
    if (!idPattern.test(clue.id)) {
      throw new Error(
        `liar-liar clue bank: clue id "${clue.id}" must match ${clue.category}-NNN (3 digits)`,
      );
    }

    if (typeof clue.clue !== 'string' || clue.clue.trim().length === 0) {
      throw new Error(`liar-liar clue bank: ${pos} has an empty clue`);
    }
    if (typeof clue.answer !== 'string' || clue.answer.trim().length === 0) {
      throw new Error(`liar-liar clue bank: ${pos} has an empty answer`);
    }
    if (clue.aliases !== undefined) {
      if (
        !Array.isArray(clue.aliases) ||
        clue.aliases.some((a) => typeof a !== 'string' || a.length === 0)
      ) {
        throw new Error(
          `liar-liar clue bank: ${pos} aliases must be an array of non-empty strings`,
        );
      }
    }
    if (
      clue.source !== undefined &&
      (typeof clue.source !== 'string' || clue.source.length === 0)
    ) {
      throw new Error(`liar-liar clue bank: ${pos} source must be a non-empty string when present`);
    }

    // No duplicate prompts within a category.
    let seenPrompts = promptsByCategory.get(clue.category);
    if (!seenPrompts) {
      seenPrompts = new Set<string>();
      promptsByCategory.set(clue.category, seenPrompts);
    }
    const normalized = clue.clue.trim().toLowerCase();
    if (seenPrompts.has(normalized)) {
      throw new Error(
        `liar-liar clue bank: duplicate prompt in category "${clue.category}": "${clue.clue}"`,
      );
    }
    seenPrompts.add(normalized);
  }
}
