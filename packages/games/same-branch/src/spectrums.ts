// Same Branch spectrum bank: the data contract, loader, and validator. A spectrum is the branch a
// round is played on - two opposite ends (the root and the tip) that a hidden target (the bud) sits
// between. Players read the Reader's one-line clue (the hunch) and move the sap line to where they
// think the bud is. The shape and loader mirror the Liar Liar clue bank (spec 0021): the public repo
// ships a small SAMPLE, the full research-sourced bank later lives in the private data repo mounted at
// GAME_DATA_DIR (spec 0041). `validateSpectrumBank` checks per-item STRUCTURE only (schema, id format
// + uniqueness, non-empty ends, distinct ends) - there is no per-category count gate, because the bank
// grows over time and its category spread is deliberately uneven.

import type { AssetLoader } from '@branchout/game-sdk';

/** One spectrum: the two opposite ends of a branch, plus the category it belongs to. */
export interface Spectrum {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The label at the root (0) end of the branch, e.g. "cold". */
  left: string;
  /** The label at the tip (100) end of the branch, e.g. "hot". */
  right: string;
}

/** The six spectrum categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = ['senses', 'feelings', 'everyday', 'nature', 'people', 'wild'] as const;

export type SpectrumCategory = (typeof CATEGORIES)[number];

/** Id convention: `<category>-NNN` (3-digit zero-padded suffix). */
const ID_PATTERN = /^[a-z]+-\d{3}$/;

/**
 * Read every category file (`data/same-branch/<category>.json`) through the injected loader and return
 * the flattened spectrum array. Rooted at this package via the asset loader, so it works from `src`
 * under tsx and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadSpectrumBank(assets: AssetLoader): Promise<Spectrum[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<Spectrum[]>(`data/same-branch/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`same-branch spectrum bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  return perCategory.flat();
}

/**
 * Validate the STRUCTURE of every spectrum in the bank. Runs at engine boot on any bank size (the
 * public sample or the full private bank). Throws a descriptive `Error` on the first violation. There
 * is no per-category count/coverage gate: the bank grows over time and its category spread is
 * deliberately uneven, so a bank of any size validates as long as each item is well-formed.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `<category>-NNN` (3-digit suffix).
 * 2. `category` is one of {@link CATEGORIES}.
 * 3. `left` and `right` are non-empty strings and are not the same label.
 * 4. No duplicate `left|right` pair within a single category.
 */
export function validateSpectrumBank(spectrums: readonly Spectrum[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  // Track ends seen per category, so a duplicate pair in the same category is caught.
  const pairsByCategory = new Map<string, Set<string>>();

  for (const spectrum of spectrums) {
    const pos = `spectrum id=${JSON.stringify(spectrum.id)}`;

    if (typeof spectrum.id !== 'string' || spectrum.id.length === 0) {
      throw new Error(`same-branch spectrum bank: a spectrum has a missing or empty id`);
    }
    if (seen.has(spectrum.id)) {
      throw new Error(`same-branch spectrum bank: duplicate id "${spectrum.id}"`);
    }
    seen.add(spectrum.id);

    if (typeof spectrum.category !== 'string' || !categories.has(spectrum.category)) {
      throw new Error(
        `same-branch spectrum bank: ${pos} has category ${JSON.stringify(spectrum.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }

    // Id must follow the <category>-NNN convention (a static pattern plus a startsWith check, matching
    // the Liar Liar validator) rather than interpolating the category into a regex source.
    if (!ID_PATTERN.test(spectrum.id) || !spectrum.id.startsWith(`${spectrum.category}-`)) {
      throw new Error(
        `same-branch spectrum bank: spectrum id "${spectrum.id}" must match ${spectrum.category}-NNN (3 digits)`,
      );
    }

    if (typeof spectrum.left !== 'string' || spectrum.left.trim().length === 0) {
      throw new Error(`same-branch spectrum bank: ${pos} has an empty left end`);
    }
    if (typeof spectrum.right !== 'string' || spectrum.right.trim().length === 0) {
      throw new Error(`same-branch spectrum bank: ${pos} has an empty right end`);
    }
    if (spectrum.left.trim().toLowerCase() === spectrum.right.trim().toLowerCase()) {
      throw new Error(`same-branch spectrum bank: ${pos} has identical left and right ends`);
    }

    // No duplicate end-pair within a category.
    let seenPairs = pairsByCategory.get(spectrum.category);
    if (!seenPairs) {
      seenPairs = new Set<string>();
      pairsByCategory.set(spectrum.category, seenPairs);
    }
    const normalized = `${spectrum.left.trim().toLowerCase()}|${spectrum.right.trim().toLowerCase()}`;
    if (seenPairs.has(normalized)) {
      throw new Error(
        `same-branch spectrum bank: duplicate pair in category "${spectrum.category}": ` +
          `"${spectrum.left}" <-> "${spectrum.right}"`,
      );
    }
    seenPairs.add(normalized);
  }
}
