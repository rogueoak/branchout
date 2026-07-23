// Trivia question bank: loader and validator for the 10-category question set (spec 0074).
//
// Data lives at data/trivia/<category>.json (one file per category). The public repo ships a small
// SAMPLE; the full bank is served from the private data repo mounted at GAME_DATA_DIR (see
// deploy/README.md and packages/game-sdk assets). IDs use a lowercase-category prefix, e.g.
// `nature-001`. The loader takes an injected AssetLoader (from @branchout/game-sdk) rooted at the
// data source, so it reads whether the code runs from `src` under tsx, the bundled `dist`, or the
// mount - no self-locating filesystem walk. The bank grows over time and its difficulty spread is
// deliberately uneven, so validation checks per-item structure only, never a total/per-category
// count or a spread.
//
// A question is one of two shapes, discriminated by `type` (spec 0074):
//   - a RECALL item (`type` omitted or `"recall"`): free-text `answers`, optionally MC-capable when
//     it carries `choices` (>= 3 distractors);
//   - a TRUE/FALSE item (`type: "true-false"`): a statement in `prompt` judged against `isTrue`, no
//     `answers`.
// Recall defaults to `type: "recall"` when the field is absent, so the existing recall bank needs no
// rewrite.

import type { AssetLoader } from '@branchout/game-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recall (open + MC-capable) question: free-text `answers`, optionally `choices` for multiple choice. */
export interface RecallQuestion {
  /** Unique identifier, format `<category>-NNN` (zero-padded 3 digits). */
  id: string;
  /** Recall is the default shape; the field may be omitted or set to `'recall'` explicitly. */
  type?: 'recall';
  /** Proper-cased category name, e.g. `"Nature"`. */
  category: string;
  /** The question text shown to players. */
  prompt: string;
  /**
   * One or more accepted answers. Stored in display Title Case (`answers[0]` is the canonical
   * answer shown on reveal); the matcher lowercases both sides, so matching is case-insensitive.
   */
  answers: string[];
  /**
   * Optional distractors (>= 3) that make this item multiple-choice-eligible (spec 0074). The MC
   * options are `[answers[0], ...choices.slice(0, 3)]`, shuffled by the engine rng at draw time.
   * Without `choices` the item is open-answer only.
   */
  choices?: string[];
  /**
   * Difficulty rating: an integer 1 (near-universal knowledge) to 10 (obscure/expert). The host
   * picks a min-max range (spec 0016) and the draw selects questions whose rating falls in it.
   */
  difficulty: number;
}

/** A true/false question: a statement judged against `isTrue`; carries no `answers` (spec 0074). */
export interface TrueFalseQuestion {
  /** Unique identifier, format `<category>-NNN` (zero-padded 3 digits). */
  id: string;
  /** The discriminator that marks this as a true/false item. */
  type: 'true-false';
  /** Proper-cased category name, e.g. `"Nature"`. */
  category: string;
  /** The statement shown to players to judge true or false. */
  prompt: string;
  /** Whether the statement is factually true. */
  isTrue: boolean;
  /** Difficulty rating: an integer 1-10, as for recall items. */
  difficulty: number;
}

/** A bank question is one of the two shapes, discriminated by `type` (spec 0074). */
export type TriviaQuestion = RecallQuestion | TrueFalseQuestion;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True for a true/false item. */
export function isTrueFalseQuestion(q: TriviaQuestion): q is TrueFalseQuestion {
  return q.type === 'true-false';
}

/** True for a recall item (the default when `type` is absent). */
export function isRecallQuestion(q: TriviaQuestion): q is RecallQuestion {
  return q.type === undefined || q.type === 'recall';
}

/** True for a recall item that carries enough distractors (>= 3) to be multiple-choice-eligible. */
export function isMultipleChoiceCapable(
  q: TriviaQuestion,
): q is RecallQuestion & { choices: string[] } {
  return isRecallQuestion(q) && Array.isArray(q.choices) && q.choices.length >= 3;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Proper-cased category names - the canonical 10 question categories (spec 0074 adds Movies + Music). */
export const CATEGORIES: readonly string[] = [
  'Nature',
  'Food',
  'Animals',
  'Science',
  'People',
  'Places',
  'Things',
  'History',
  'Movies',
  'Music',
] as const;

/** Difficulty rating bounds - every question rates an integer in this inclusive range. */
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Reads all trivia JSON files (one per category) through the injected asset loader and returns the
 * combined question array. The loader is rooted at the data source (the package's bundled sample, or
 * the mount at GAME_DATA_DIR - see the trivia plugin's `create`), so paths resolve to
 * `data/trivia/<category>.json` regardless of where the process is launched from.
 */
export async function loadQuestionBank(assets: AssetLoader): Promise<TriviaQuestion[]> {
  const perCategory = await Promise.all(
    CATEGORIES.map(async (category) => {
      const filename = `${category.toLowerCase()}.json`;
      const parsed = await assets.readJson<TriviaQuestion[]>(`data/trivia/${filename}`);
      if (!Array.isArray(parsed)) {
        throw new Error(`question-bank: ${filename} must be a JSON array`);
      }
      return parsed;
    }),
  );
  const bank = perCategory.flat();
  // Fail fast at load (boot) rather than let a malformed item crash `startRound` mid-game: a recall
  // item missing `answers`, a bad `type`, or a distractor equal to its answer throws here (security
  // review, PR #174). Data is first-party, so a throw is a deploy-time signal, not a player path.
  validateQuestionBank(bank);
  return bank;
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
 * 2. Each `id` matches the pattern `<lowercase-category>-NNN` (3-digit zero-padded suffix). The
 *    `type` field, not the id, marks the shape, so true/false items share the same id pattern.
 * 3. Shape-dependent (spec 0074):
 *    - recall (`type` absent or `'recall'`): `answers` is non-empty with non-empty strings; when
 *      `choices` is present it must be a string[] of >= 3 non-empty entries.
 *    - true/false (`type: 'true-false'`): `isTrue` is a boolean; no `answers` are required.
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

    // 3. Shape-dependent fields.
    if (isTrueFalseQuestion(q)) {
      if (typeof q.isTrue !== 'boolean') {
        throw new Error(
          `question-bank validation failed: ${pos} is a true/false item but isTrue is not a boolean` +
            ` (got ${JSON.stringify(q.isTrue)})`,
        );
      }
    } else if (q.type === undefined || q.type === 'recall') {
      const recall = q as RecallQuestion;
      if (!Array.isArray(recall.answers) || recall.answers.length === 0) {
        throw new Error(`question-bank validation failed: ${pos} has empty answers array`);
      }
      for (const answer of recall.answers) {
        if (typeof answer !== 'string' || answer.length === 0) {
          throw new Error(`question-bank validation failed: ${pos} has a blank answer`);
        }
        // Casing is intentionally not enforced: answers are stored in display Title Case and the
        // matcher normalizes both sides to lowercase (see matching.ts), so matching is unaffected.
      }
      if (recall.choices !== undefined) {
        if (!Array.isArray(recall.choices) || recall.choices.length < 3) {
          throw new Error(
            `question-bank validation failed: ${pos} has choices but fewer than 3 distractors` +
              ` (got ${JSON.stringify(recall.choices)})`,
          );
        }
        // Distractors must be wrong: a choice equal (case-insensitively) to any accepted answer would
        // yield a duplicate multiple-choice option and let a player score correct by tapping the
        // "distractor" (engineer review, PR #174).
        const answerSet = new Set(recall.answers.map((a) => a.toLowerCase()));
        for (const choice of recall.choices) {
          if (typeof choice !== 'string' || choice.length === 0) {
            throw new Error(`question-bank validation failed: ${pos} has a blank choice`);
          }
          if (answerSet.has(choice.toLowerCase())) {
            throw new Error(
              `question-bank validation failed: ${pos} has a distractor equal to an accepted answer` +
                ` (${JSON.stringify(choice)})`,
            );
          }
        }
      }
    } else {
      throw new Error(
        `question-bank validation failed: ${pos} has an unknown type ${JSON.stringify(q.type)}`,
      );
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
