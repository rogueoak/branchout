// Odd Bird roost bank: the data contract, loader, and validator. A roost is a location every member
// of the flock shares, plus a list of distinct perches (roles at that location) the game deals out.
// The shape and loader mirror the Liar Liar clue bank (spec 0021). The public repo ships a small
// SAMPLE bank under data/odd-bird/*.json; a fuller research-sourced bank would later live in the
// private data repo mounted at GAME_DATA_DIR (spec 0041). `validateRoostBank` checks per-item
// STRUCTURE only (schema, id format + uniqueness, enough distinct perches, no duplicate name in a
// category) - there is no per-category count gate, because the bank grows over time and its category
// spread is deliberately uneven.

import type { AssetLoader } from '@branchout/game-sdk';

/** One roost: a shared location and the distinct perches (roles) the flock is dealt at it. */
export interface OddBirdRoost {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The location every member of the flock is told (e.g. "A beehive"). */
  name: string;
  /** Distinct roles at the roost. Must be at least {@link MIN_PERCHES}; one is dealt per flock member. */
  perches: string[];
}

/** The five roost categories a host may choose from (1 or more, or `random` across all). */
export const CATEGORIES = ['everyday', 'outdoors', 'travel', 'events', 'fantastical'] as const;

export type OddBirdCategory = (typeof CATEGORIES)[number];

/**
 * The most players Odd Bird seats. The flock is everyone but the odd bird, so a roost needs at least
 * `MAX_PLAYERS - 1` distinct perches to deal a unique perch to every member of the largest flock.
 */
export const MAX_PLAYERS = 8;

/** A roost must ship at least this many distinct perches (one per flock member at the max table). */
export const MIN_PERCHES = MAX_PLAYERS - 1;

/**
 * Read every category file (`data/odd-bird/<category>.json`) through the injected loader and return
 * the flattened roost array. Rooted at this package via the asset loader, so it works from `src`
 * under tsx and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadRoostBank(assets: AssetLoader): Promise<OddBirdRoost[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<OddBirdRoost[]>(`data/odd-bird/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`odd-bird roost bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  return perCategory.flat();
}

/**
 * Validate the STRUCTURE of every roost in the bank. Runs at engine boot on any bank size (the public
 * sample or a fuller private bank). Throws a descriptive `Error` on the first violation. There is no
 * per-category count/coverage gate: the bank grows over time and its category spread is deliberately
 * uneven, so a bank of any size validates as long as each item is well-formed.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `<category>-NNN` (3-digit suffix).
 * 2. `category` is one of {@link CATEGORIES}.
 * 3. `name` is a non-empty string; no duplicate `name` within a single category.
 * 4. `perches` is an array of at least {@link MIN_PERCHES} distinct, non-empty strings.
 */
export function validateRoostBank(roosts: readonly OddBirdRoost[]): void {
  const seen = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  // Track names seen per category, so a duplicate roost name in the same category is caught.
  const namesByCategory = new Map<string, Set<string>>();

  for (const roost of roosts) {
    const pos = `roost id=${JSON.stringify(roost.id)}`;

    if (typeof roost.id !== 'string' || roost.id.length === 0) {
      throw new Error(`odd-bird roost bank: a roost has a missing or empty id`);
    }
    if (seen.has(roost.id)) {
      throw new Error(`odd-bird roost bank: duplicate id "${roost.id}"`);
    }
    seen.add(roost.id);

    if (typeof roost.category !== 'string' || !categories.has(roost.category)) {
      throw new Error(
        `odd-bird roost bank: ${pos} has category ${JSON.stringify(roost.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }

    // Id must follow the <category>-NNN convention (3-digit zero-padded suffix). A static pattern
    // plus a startsWith check (matching the Liar Liar validator) - correct here since category is
    // pre-validated, and the static form removes any injection footgun.
    const idPattern = /^[a-z]+-\d{3}$/;
    if (!idPattern.test(roost.id) || !roost.id.startsWith(`${roost.category}-`)) {
      throw new Error(
        `odd-bird roost bank: roost id "${roost.id}" must match ${roost.category}-NNN (3 digits)`,
      );
    }

    if (typeof roost.name !== 'string' || roost.name.trim().length === 0) {
      throw new Error(`odd-bird roost bank: ${pos} has an empty name`);
    }

    if (!Array.isArray(roost.perches)) {
      throw new Error(`odd-bird roost bank: ${pos} perches must be an array`);
    }
    if (roost.perches.length < MIN_PERCHES) {
      throw new Error(
        `odd-bird roost bank: ${pos} has ${roost.perches.length} perches, need at least ${MIN_PERCHES}`,
      );
    }
    const perchSet = new Set<string>();
    for (const perch of roost.perches) {
      if (typeof perch !== 'string' || perch.trim().length === 0) {
        throw new Error(`odd-bird roost bank: ${pos} perches must be non-empty strings`);
      }
      const normalized = perch.trim().toLowerCase();
      if (perchSet.has(normalized)) {
        throw new Error(`odd-bird roost bank: ${pos} has a duplicate perch "${perch}"`);
      }
      perchSet.add(normalized);
    }

    // No duplicate roost names within a category.
    let seenNames = namesByCategory.get(roost.category);
    if (!seenNames) {
      seenNames = new Set<string>();
      namesByCategory.set(roost.category, seenNames);
    }
    const normalizedName = roost.name.trim().toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(
        `odd-bird roost bank: duplicate name in category "${roost.category}": "${roost.name}"`,
      );
    }
    seenNames.add(normalizedName);
  }
}
