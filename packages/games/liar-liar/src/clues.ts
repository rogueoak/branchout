// Liar Liar clue bank: the data contract, loader, and validator. A clue is an improbable-but-true
// statement with a genuine (surprising) answer; players invent fakes around it. The shape and loader
// are spec 0021; the seed content (data/liar-liar/*.json, research-sourced) ships in spec 0022.
// `validateClueBank` is the lenient schema+id gate (used at boot and by synthetic tests);
// `validateSeedBank` adds the strict per-category coverage gate for the real shipped bank.

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
    if (
      clue.source !== undefined &&
      (typeof clue.source !== 'string' || clue.source.length === 0)
    ) {
      throw new Error(`liar-liar clue bank: ${pos} source must be a non-empty string when present`);
    }
  }
}

/** The minimum number of clues each category must carry for the shipped seed bank. */
export const MIN_CLUES_PER_CATEGORY = 12;

/**
 * The strict gate for the *real* shipped bank (spec 0022): everything {@link validateClueBank} checks,
 * plus category coverage (every category present with at least {@link MIN_CLUES_PER_CATEGORY} clues),
 * the `<category>-NNN` id convention, and no duplicate prompt within a category. Kept separate from
 * validateClueBank so synthetic/partial banks in unit tests still validate.
 */
export function validateSeedBank(clues: readonly LiarLiarClue[]): void {
  validateClueBank(clues);

  const byCategory = new Map<string, LiarLiarClue[]>();
  for (const clue of clues) {
    let bucket = byCategory.get(clue.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(clue.category, bucket);
    }
    bucket.push(clue);
  }

  for (const category of CATEGORIES) {
    const bucket = byCategory.get(category) ?? [];
    if (bucket.length < MIN_CLUES_PER_CATEGORY) {
      throw new Error(
        `liar-liar clue bank: category "${category}" has ${bucket.length} clues, ` +
          `expected at least ${MIN_CLUES_PER_CATEGORY}`,
      );
    }

    const idPattern = new RegExp(`^${category}-\\d{3}$`);
    const seenPrompts = new Set<string>();
    for (const clue of bucket) {
      if (!idPattern.test(clue.id)) {
        throw new Error(
          `liar-liar clue bank: clue id "${clue.id}" must match ${category}-NNN (3 digits)`,
        );
      }
      const normalized = clue.clue.trim().toLowerCase();
      if (seenPrompts.has(normalized)) {
        throw new Error(
          `liar-liar clue bank: duplicate prompt in category "${category}": "${clue.clue}"`,
        );
      }
      seenPrompts.add(normalized);
    }
  }
}
