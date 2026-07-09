// Trivia question bank: loader and validator for the 8-category question set.
//
// Data lives at apps/game-engine/data/trivia/<category>.json (200 questions per file,
// 1600 total). IDs use a lowercase-category prefix, e.g. `nature-001`.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

/** Expected total question count across all categories. */
const TOTAL_EXPECTED = 1600;

/** Expected questions per category. */
const PER_CATEGORY = 200;

/** Difficulty rating bounds - every question rates an integer in this inclusive range. */
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;

/**
 * A category must spread across the scale, not clump at one rating: at least this many distinct
 * ratings and at least this wide a span. This guards a degenerate re-rate (e.g. everything a 5)
 * that would make the host's min-max range meaningless, without demanding a precise distribution.
 */
const MIN_DISTINCT_RATINGS = 6;
const MIN_RATING_SPAN = 6;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Locates `data/trivia` by walking up from this module to the game-engine app root that owns it.
 * Robust to where the code runs from: source at `src/games/trivia/` under tsx in dev, or bundled
 * into `dist/index.js` in prod - both sit under `apps/game-engine`, which holds `data/`, never
 * `dist/`. A fixed number of `..` would differ between the two, so we search instead.
 */
function resolveTriviaDataDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'data', 'trivia');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break; // reached the filesystem root
    }
    dir = parent;
  }
  throw new Error('question-bank: could not locate the data/trivia directory');
}

/**
 * Reads all 8 trivia JSON files and returns the combined question array.
 * Resolves paths relative to this module so it works wherever the process is launched from.
 */
export async function loadQuestionBank(): Promise<TriviaQuestion[]> {
  const dir = resolveTriviaDataDir();

  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const filename = `${category.toLowerCase()}.json`;
      const raw = await readFile(path.join(dir, filename), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`question-bank: ${filename} must be a JSON array`);
      }
      // Unchecked cast: validateQuestionBank() enforces the schema at runtime.
      return parsed as TriviaQuestion[];
    }),
  );
  return perCategory.flat();
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validates the full question bank against all spec constraints.
 * Throws with a descriptive message on the first violation found.
 * Returns void on success.
 *
 * Rules enforced:
 * 1. Exactly 1600 questions total.
 * 2. Exactly 200 questions per category (matched on `question.category`).
 * 3. Each `id` is unique across the entire bank.
 * 4. Each `id` matches the pattern `<lowercase-category>-NNN` (3-digit zero-padded suffix).
 * 5. `answers` is non-empty and every answer is a non-empty all-lowercase string.
 * 6. `difficulty` is an integer 1-10.
 * 7. Each category spreads across the scale (>= 6 distinct ratings, span >= 6).
 * 8. No duplicate `prompt` values within a single category.
 */
export function validateQuestionBank(questions: TriviaQuestion[]): void {
  // 1. Total count
  if (questions.length !== TOTAL_EXPECTED) {
    throw new Error(
      `question-bank validation failed: expected ${TOTAL_EXPECTED} total questions, got ${questions.length}`,
    );
  }

  const seenIds = new Set<string>();
  const byCategory = new Map<string, TriviaQuestion[]>();

  for (const q of questions) {
    const pos = `question id=${q.id}`;

    // 3. Unique IDs
    if (seenIds.has(q.id)) {
      throw new Error(`question-bank validation failed: duplicate id "${q.id}"`);
    }
    seenIds.add(q.id);

    // 4. ID format: <lowercase-category>-NNN
    const expectedPrefix = q.category.toLowerCase();
    const idPattern = /^[a-z]+-\d{3}$/;
    if (!idPattern.test(q.id) || !q.id.startsWith(`${expectedPrefix}-`)) {
      throw new Error(
        `question-bank validation failed: ${pos} has invalid id format` +
          ` (expected "${expectedPrefix}-NNN", got "${q.id}")`,
      );
    }

    // 5. Answers
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

    // 6. Difficulty is an integer 1-10
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

    // Group by category for per-category checks
    const bucket = byCategory.get(q.category) ?? [];
    bucket.push(q);
    byCategory.set(q.category, bucket);
  }

  // Per-category checks
  for (const category of CATEGORIES) {
    const bucket = byCategory.get(category) ?? [];

    // 2. 200 per category
    if (bucket.length !== PER_CATEGORY) {
      throw new Error(
        `question-bank validation failed: category "${category}" has ${bucket.length} questions, expected ${PER_CATEGORY}`,
      );
    }

    // 7. Difficulty spread: the category must span the scale, not clump at one rating.
    const ratings = bucket.map((q) => q.difficulty);
    const distinct = new Set(ratings).size;
    const span = Math.max(...ratings) - Math.min(...ratings);
    if (distinct < MIN_DISTINCT_RATINGS || span < MIN_RATING_SPAN) {
      throw new Error(
        `question-bank validation failed: category "${category}" difficulty is too clumped` +
          ` (${distinct} distinct ratings, span ${span}; need >= ${MIN_DISTINCT_RATINGS} distinct` +
          ` and span >= ${MIN_RATING_SPAN})`,
      );
    }

    // 8. No duplicate prompts within a category
    const seenPrompts = new Set<string>();
    for (const q of bucket) {
      const normalised = q.prompt.trim().toLowerCase();
      if (seenPrompts.has(normalised)) {
        throw new Error(
          `question-bank validation failed: duplicate prompt in category "${category}": "${q.prompt}"`,
        );
      }
      seenPrompts.add(normalised);
    }
  }
}
