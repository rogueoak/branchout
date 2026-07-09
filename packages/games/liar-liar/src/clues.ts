// Liar Liar clue bank: the data contract, loader, and validator (spec 0021). A clue is an
// improbable-but-true statement with a genuine (surprising) answer; players invent fakes around it.
// The real content ships in a later spec (0022) - this module defines the shape and how to load it
// through the injected asset loader, and is exercised here with synthetic clues.

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
 * Validate a clue bank's schema and id uniqueness. Throws a descriptive `Error` on the first
 * violation. Category *coverage* (which categories exist and how many) is a content concern of the
 * bank spec (0022), not enforced here, so a synthetic or partial bank validates fine.
 */
export function validateClueBank(clues: readonly LiarLiarClue[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);

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
  }
}
