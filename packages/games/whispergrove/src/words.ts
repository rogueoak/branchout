// Whispergrove word bank: the data contract, loader, and structural validator (spec 0062, mirroring
// the spec 0041 pattern). A "word" is a single common noun that prints on a leaf. The public repo
// ships a small-but-real SAMPLE under data/whispergrove/*.json; a full bank would later live in the
// private data repo mounted at GAME_DATA_DIR. `validateWordBank` checks per-item STRUCTURE only
// (single-token noun, category membership, no duplicates) - there is no per-category count gate.

import type { AssetLoader } from '@branchout/game-sdk';

/** The word categories a host may fill the grove from (or `random` across all). */
export const CATEGORIES = ['nature', 'places', 'objects', 'creatures'] as const;

export type WhispergroveCategory = (typeof CATEGORIES)[number];

/** One entry in a category file: the noun to print on a leaf. */
export type WordEntry = string;

/** A single-token word: letters only (ASCII), no spaces/punctuation, so it never collides with a
 * multi-word phrase and the "whisper is not a board word" check is a clean string compare. */
const WORD_PATTERN = /^[A-Za-z]+$/;

/**
 * Read every selected category file (`data/whispergrove/<category>.json`) through the injected loader
 * and return the flattened, de-duplicated, upper-cased word list. Rooted at this package via the
 * asset loader, so it works from `src` under tsx and from the bundled `dist` alike. A missing or
 * malformed file throws, aborting the game start.
 */
export async function loadWordBank(
  assets: AssetLoader,
  categories: readonly WhispergroveCategory[],
): Promise<string[]> {
  const perCategory = await Promise.all(
    categories.map(async (category) => {
      const parsed = await assets.readJson<WordEntry[]>(`data/whispergrove/${category}.json`);
      if (!Array.isArray(parsed)) {
        throw new Error(`whispergrove word bank: ${category}.json must be a JSON array`);
      }
      return parsed;
    }),
  );
  // Flatten, normalize to upper case, and de-dupe across categories (a word may appear in two).
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of perCategory.flat()) {
    const upper = String(word).trim().toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      words.push(upper);
    }
  }
  return words;
}

/**
 * Validate the STRUCTURE of a raw category array. Runs on any bank size (the public sample or a full
 * private bank). Throws a descriptive `Error` on the first violation. No count/coverage gate: the
 * bank grows over time, so a file of any length validates as long as each entry is well-formed.
 *
 * Per-item rules:
 * 1. Each entry is a non-empty string.
 * 2. Each entry is a single ASCII-letter token (no spaces, digits, or punctuation).
 * 3. No duplicate word within the file (case-insensitive).
 */
export function validateWordCategory(category: string, entries: readonly unknown[]): void {
  if (!Array.isArray(entries)) {
    throw new Error(`whispergrove word bank: ${category} must be a JSON array`);
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`whispergrove word bank: ${category} has a missing or empty word`);
    }
    const word = entry.trim();
    if (!WORD_PATTERN.test(word)) {
      throw new Error(
        `whispergrove word bank: ${category} word ${JSON.stringify(entry)} must be a single ASCII-letter token`,
      );
    }
    const key = word.toUpperCase();
    if (seen.has(key)) {
      throw new Error(`whispergrove word bank: ${category} has duplicate word "${word}"`);
    }
    seen.add(key);
  }
}

/** True when `word` is a legal single-token whisper (same rule as a bank word). */
export function isSingleToken(word: string): boolean {
  return WORD_PATTERN.test(word.trim());
}
