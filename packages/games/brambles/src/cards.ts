// Brambles card bank: the data contract, loader, and structural validator (spec 0061). A card is a
// "bloom" (the target word a describer must get their team to say) plus a short list of "thorns"
// (forbidden words the describer must avoid). The public repo ships a small but real SAMPLE under
// data/brambles/*.json; the full bank would later live in the private data repo mounted at
// GAME_DATA_DIR (spec 0041). `validateCardBank` checks per-item STRUCTURE only (schema, id
// format + uniqueness, non-empty bloom, exactly the required thorn count) - there is no per-category
// count gate, since the bank grows over time.

import type { AssetLoader } from '@branchout/game-sdk';

/** Every card carries exactly this many thorns (forbidden words), matching the tabletop card face. */
export const THORNS_PER_CARD = 5;

/** One card: a target word to describe plus the forbidden words the Guide must dodge. */
export interface BramblesCard {
  /** Unique id, conventionally `<category>-NNN`. */
  id: string;
  /** One of {@link CATEGORIES}. */
  category: string;
  /** The target word the Guide gets their team to say (the "bloom"). */
  bloom: string;
  /** The forbidden words that PRICK the card if the Guide says one (the "thorns"). */
  thorns: string[];
}

/** The card categories a host may choose from (or `random` across all). */
export const CATEGORIES = ['nature', 'everyday', 'action', 'places', 'food', 'people'] as const;

export type BramblesCategory = (typeof CATEGORIES)[number];

/**
 * Read every category file (`data/brambles/<category>.json`) through the injected loader and return
 * the flattened card array. Rooted at this package via the asset loader, so it works from `src` under
 * tsx and from the bundled `dist` alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadCardBank(assets: AssetLoader): Promise<BramblesCard[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const parsed = await assets.readJson<BramblesCard[]>(`data/brambles/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`brambles card bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  return perCategory.flat();
}

/**
 * Validate the STRUCTURE of every card in the bank. Runs at engine boot on any bank size (the public
 * sample or the full private bank). Throws a descriptive `Error` on the first violation. There is no
 * per-category count/coverage gate.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `<category>-NNN` (3-digit suffix).
 * 2. `category` is one of {@link CATEGORIES}.
 * 3. `bloom` is a non-empty string.
 * 4. `thorns` is an array of exactly {@link THORNS_PER_CARD} non-empty strings, all distinct, none
 *    equal to the bloom.
 * 5. No duplicate `bloom` within a single category.
 */
export function validateCardBank(cards: readonly BramblesCard[]): void {
  const seenIds = new Set<string>();
  const categories = new Set<string>(CATEGORIES);
  const bloomsByCategory = new Map<string, Set<string>>();
  const idPattern = /^[a-z]+-\d{3}$/;

  for (const card of cards) {
    const pos = `card id=${JSON.stringify(card.id)}`;

    if (typeof card.id !== 'string' || card.id.length === 0) {
      throw new Error(`brambles card bank: a card has a missing or empty id`);
    }
    if (seenIds.has(card.id)) {
      throw new Error(`brambles card bank: duplicate id "${card.id}"`);
    }
    seenIds.add(card.id);

    if (typeof card.category !== 'string' || !categories.has(card.category)) {
      throw new Error(
        `brambles card bank: ${pos} has category ${JSON.stringify(card.category)}, ` +
          `expected one of ${CATEGORIES.join(', ')}`,
      );
    }
    if (!idPattern.test(card.id) || !card.id.startsWith(`${card.category}-`)) {
      throw new Error(
        `brambles card bank: card id "${card.id}" must match ${card.category}-NNN (3 digits)`,
      );
    }

    if (typeof card.bloom !== 'string' || card.bloom.trim().length === 0) {
      throw new Error(`brambles card bank: ${pos} has an empty bloom`);
    }

    if (!Array.isArray(card.thorns) || card.thorns.length !== THORNS_PER_CARD) {
      throw new Error(
        `brambles card bank: ${pos} must have exactly ${THORNS_PER_CARD} thorns, ` +
          `got ${Array.isArray(card.thorns) ? card.thorns.length : typeof card.thorns}`,
      );
    }
    const seenThorns = new Set<string>();
    for (const thorn of card.thorns) {
      if (typeof thorn !== 'string' || thorn.trim().length === 0) {
        throw new Error(`brambles card bank: ${pos} has an empty thorn`);
      }
      const key = thorn.trim().toLowerCase();
      if (key === card.bloom.trim().toLowerCase()) {
        throw new Error(`brambles card bank: ${pos} has a thorn equal to its bloom`);
      }
      if (seenThorns.has(key)) {
        throw new Error(`brambles card bank: ${pos} has a duplicate thorn "${thorn}"`);
      }
      seenThorns.add(key);
    }

    let seenBlooms = bloomsByCategory.get(card.category);
    if (!seenBlooms) {
      seenBlooms = new Set<string>();
      bloomsByCategory.set(card.category, seenBlooms);
    }
    const normalizedBloom = card.bloom.trim().toLowerCase();
    if (seenBlooms.has(normalizedBloom)) {
      throw new Error(
        `brambles card bank: duplicate bloom in category "${card.category}": "${card.bloom}"`,
      );
    }
    seenBlooms.add(normalizedBloom);
  }
}
