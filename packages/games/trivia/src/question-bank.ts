// Trivia question bank: loader and validator for the 8-category question set.
//
// Data lives at data/trivia/<category>.json (one file per category). The public repo ships a small
// SAMPLE; the full bank is served from the private data repo mounted at GAME_DATA_DIR (see
// deploy/README.md and packages/game-sdk assets). IDs use a lowercase-category prefix, e.g.
// `nature-001`. The loader takes an injected AssetLoader (from @branchout/game-sdk) rooted at the
// data source, so it reads whether the code runs from `src` under tsx, the bundled `dist`, or the
// mount - no self-locating filesystem walk. The bank grows over time and its difficulty spread is
// deliberately uneven, so validation checks per-item structure only, never a total/per-category
// count or a spread.

import type { AssetLoader } from '@branchout/game-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriviaQuestion {
  /** Unique identifier, format `<category>-NNN` (zero-padded 3 digits). */
  id: string;
  /** Proper-cased category name, e.g. `"Nature"`. */
  category: string;
  /** The question text shown to players. */
  prompt: string;
  /** One or more accepted answers (all lowercase). */
  answers: string[];
  /**
   * Difficulty rating: an integer 1 (near-universal knowledge) to 10 (obscure/expert). The host
   * picks a min-max range (spec 0016) and the draw selects questions whose rating falls in it.
   */
  difficulty: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Proper-cased category names — the canonical 8 question categories. */
export const CATEGORIES: readonly string[] = [
  'Nature',
  'Food',
  'Animals',
  'Science',
  'People',
  'Places',
  'Things',
  'History',
] as const;

/** Difficulty rating bounds - every question rates an integer in this inclusive range. */
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Reads all 8 trivia JSON files through the injected asset loader and returns the combined question
 * array. The loader is rooted at the data source (the package's bundled sample, or the mount at
 * GAME_DATA_DIR - see the trivia plugin's `create`), so paths resolve to `data/trivia/<category>.json`
 * regardless of where the process is launched from.
 */
export async function loadQuestionBank(assets: AssetLoader): Promise<TriviaQuestion[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const filename = `${category.toLowerCase()}.json`;
      const parsed = await assets.readJson<TriviaQuestion[]>(`data/trivia/${filename}`);
      if (!Array.isArray(parsed)) {
        throw new Error(`question-bank: ${filename} must be a JSON array`);
      }
      // Unchecked cast: validateQuestionBank() enforces the schema at runtime.
      return parsed;
    }),
  );
  return perCategory.flat();
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validates the STRUCTURE of every question in the bank. Runs at engine boot on any bank size (the
 * public sample or the full private bank) - there is no total, per-category count, or difficulty
 * spread gate, because the bank grows over time and its spread is deliberately uneven. Throws with a
 * descriptive message on the first violation found; returns void on success.
 *
 * Per-item rules enforced:
 * 1. Each `id` is unique across the entire bank.
 * 2. Each `id` matches the pattern `<lowercase-category>-NNN` (3-digit zero-padded suffix).
 * 3. `answers` is non-empty and every answer is a non-empty all-lowercase string.
 * 4. `difficulty` is an integer 1-10.
 * 5. No duplicate `prompt` values within a single category.
 */
export function validateQuestionBank(questions: TriviaQuestion[]): void {
  const seenIds = new Set<string>();
  // Track prompts seen per category, so a duplicate prompt in the same category is caught.
  const promptsByCategory = new Map<string, Set<string>>();

  for (const q of questions) {
    const pos = `question id=${q.id}`;

    // 1. Unique IDs
    if (seenIds.has(q.id)) {
      throw new Error(`question-bank validation failed: duplicate id "${q.id}"`);
    }
    seenIds.add(q.id);

    // 2. ID format: <lowercase-category>-NNN
    const expectedPrefix = q.category.toLowerCase();
    const idPattern = /^[a-z]+-\d{3}$/;
    if (!idPattern.test(q.id) || !q.id.startsWith(`${expectedPrefix}-`)) {
      throw new Error(
        `question-bank validation failed: ${pos} has invalid id format` +
          ` (expected "${expectedPrefix}-NNN", got "${q.id}")`,
      );
    }

    // 3. Answers
    if (!Array.isArray(q.answers) || q.answers.length === 0) {
      throw new Error(`question-bank validation failed: ${pos} has empty answers array`);
    }
    for (const answer of q.answers) {
      if (typeof answer !== 'string' || answer.length === 0) {
        throw new Error(`question-bank validation failed: ${pos} has a blank answer`);
      }
      if (answer !== answer.toLowerCase()) {
        throw new Error(
          `question-bank validation failed: ${pos} answer "${answer}" must be all-lowercase`,
        );
      }
    }

    // 4. Difficulty is an integer 1-10
    if (
      !Number.isInteger(q.difficulty) ||
      q.difficulty < DIFFICULTY_MIN ||
      q.difficulty > DIFFICULTY_MAX
    ) {
      throw new Error(
        `question-bank validation failed: ${pos} has invalid difficulty ${JSON.stringify(q.difficulty)}` +
          ` (expected an integer ${DIFFICULTY_MIN}-${DIFFICULTY_MAX})`,
      );
    }

    // 5. No duplicate prompts within a category
    let seenPrompts = promptsByCategory.get(q.category);
    if (!seenPrompts) {
      seenPrompts = new Set<string>();
      promptsByCategory.set(q.category, seenPrompts);
    }
    const normalised = q.prompt.trim().toLowerCase();
    if (seenPrompts.has(normalised)) {
      throw new Error(
        `question-bank validation failed: duplicate prompt in category "${q.category}": "${q.prompt}"`,
      );
    }
    seenPrompts.add(normalised);
  }
}
