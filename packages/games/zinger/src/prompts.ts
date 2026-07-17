// Zinger prompt bank: the data contract, loader, and validator (spec 0053). A prompt is "the setup" -
// a short, clean, open or fill-in-the-blank line players answer with a funny "zinger". The shape and
// loader mirror the bluffing game's clue bank (spec 0021): the public repo ships a small SAMPLE at
// data/zinger/prompts.json; the full bank would later be served from the private data repo mounted at
// GAME_DATA_DIR (spec 0041). `validatePromptBank` checks per-item STRUCTURE only (schema, id format +
// uniqueness, no duplicate setup text) - there is no count/spread gate, because the bank grows over
// time.

import type { AssetLoader } from '@branchout/game-sdk';

/** One setup: the id and the prompt line shown to every player. */
export interface ZingerPrompt {
  /** Unique id, conventionally `prompt-NNN` (3-digit suffix). */
  id: string;
  /** The setup shown on the viewer - a fill-in-the-blank (with `___`) or open prompt. */
  setup: string;
}

/** The file, relative to the package, holding the sample prompt bank. */
export const PROMPTS_FILE = 'data/zinger/prompts.json';

/**
 * Read the prompt bank (`data/zinger/prompts.json`) through the injected loader and return it. Rooted
 * at this package via the asset loader, so it works from `src` under tsx and from the bundled `dist`
 * alike. A missing/invalid file throws, aborting the game start.
 */
export async function loadPromptBank(assets: AssetLoader): Promise<ZingerPrompt[]> {
  const parsed = await assets.readJson<ZingerPrompt[]>(PROMPTS_FILE);
  if (!Array.isArray(parsed)) {
    throw new Error(`zinger prompt bank: ${PROMPTS_FILE} must be a JSON array`);
  }
  return parsed;
}

/**
 * Validate the STRUCTURE of every prompt in the bank. Runs at engine boot on any bank size (the public
 * sample or the full private bank). Throws a descriptive `Error` on the first violation. There is no
 * count/coverage gate: the bank grows over time, so a bank of any size validates as long as each item
 * is well-formed.
 *
 * Per-item rules enforced:
 * 1. `id` is present, unique across the bank, and matches `prompt-NNN` (3-digit suffix).
 * 2. `setup` is a non-empty string.
 * 3. No duplicate `setup` line across the bank (case-insensitive, trimmed).
 */
export function validatePromptBank(prompts: readonly ZingerPrompt[]): void {
  const seenIds = new Set<string>();
  const seenSetups = new Set<string>();
  const idPattern = /^prompt-\d{3}$/;

  for (const prompt of prompts) {
    if (typeof prompt.id !== 'string' || prompt.id.length === 0) {
      throw new Error('zinger prompt bank: a prompt has a missing or empty id');
    }
    if (seenIds.has(prompt.id)) {
      throw new Error(`zinger prompt bank: duplicate id "${prompt.id}"`);
    }
    seenIds.add(prompt.id);

    if (!idPattern.test(prompt.id)) {
      throw new Error(`zinger prompt bank: id "${prompt.id}" must match prompt-NNN (3 digits)`);
    }

    if (typeof prompt.setup !== 'string' || prompt.setup.trim().length === 0) {
      throw new Error(`zinger prompt bank: prompt "${prompt.id}" has an empty setup`);
    }

    const normalized = prompt.setup.trim().toLowerCase();
    if (seenSetups.has(normalized)) {
      throw new Error(`zinger prompt bank: duplicate setup "${prompt.setup}"`);
    }
    seenSetups.add(normalized);
  }
}
