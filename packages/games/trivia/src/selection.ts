// Per-round question selection (spec 0008, difficulty range spec 0016, category subset spec 0068).
// Given the host's difficulty range [min, max], the chosen categories (an empty list draws across
// ALL categories - "Random"), and the ids already used this game, pick one unused question whose
// rating falls in the range. If the range is exhausted for the pool, widen to the nearest rating
// outside it; never repeat a question within a game.

import type { TriviaQuestion } from './question-bank';

/** The sentinel category that draws across all eight categories. */
export const RANDOM_CATEGORY = 'Random';

/** A question bank pre-indexed by category for O(1) pool lookup; build once per game. */
export interface QuestionIndex {
  /** category -> its questions; `RANDOM_CATEGORY` holds the cross-category pool. */
  readonly byCategory: ReadonlyMap<string, readonly TriviaQuestion[]>;
}

/**
 * The draw pool for a category selection. An empty list means "Random" - the pre-indexed
 * cross-category pool. A non-empty list unions the named categories' buckets (each question carries a
 * single category, so the union never double-counts). An unknown category simply contributes nothing.
 */
export function poolFor(
  index: QuestionIndex,
  categories: readonly string[],
): readonly TriviaQuestion[] {
  if (categories.length === 0) return index.byCategory.get(RANDOM_CATEGORY) ?? [];
  if (categories.length === 1) return index.byCategory.get(categories[0]!) ?? [];
  const pool: TriviaQuestion[] = [];
  for (const category of categories) {
    const bucket = index.byCategory.get(category);
    if (bucket) pool.push(...bucket);
  }
  return pool;
}

/** Build the per-category index once, including the cross-category `Random` pool. */
export function indexQuestions(bank: readonly TriviaQuestion[]): QuestionIndex {
  const byCategory = new Map<string, TriviaQuestion[]>();

  const put = (category: string, q: TriviaQuestion): void => {
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(q);
    else byCategory.set(category, [q]);
  };

  for (const q of bank) {
    put(q.category, q);
    put(RANDOM_CATEGORY, q);
  }

  return { byCategory };
}

/** How far a rating sits outside [min, max]; 0 when it is inside the range. */
function distanceToRange(rating: number, min: number, max: number): number {
  if (rating < min) return min - rating;
  if (rating > max) return rating - max;
  return 0;
}

/**
 * Pick an unused question for `categories` (empty = Random) whose rating is in [min, max]. When the
 * range holds no unused question, widen to the nearest rating outside it (a smaller surprise than
 * jumping to an extreme); a below/above tie breaks toward the easier (lower) rating. Returns `null`
 * only when every question in the pool is used - in practice unreachable: a game runs at most 100
 * rounds against 200 questions per category. `rng` selects within the candidate pool so ordering is
 * uniform and deterministic under a seeded rng.
 *
 * `accept`, when given, restricts the draw to questions it returns true for (spec 0074: the round's
 * type - an open round accepts any recall item, a multiple-choice round only a choice-bearing recall
 * item, a true/false round only a true/false item). It composes with the used-id and difficulty
 * rules: the type filter applies first, then widening runs within the accepted set.
 */
export function pickQuestion(
  index: QuestionIndex,
  categories: readonly string[],
  min: number,
  max: number,
  usedIds: ReadonlySet<string>,
  rng: () => number,
  accept?: (q: TriviaQuestion) => boolean,
): TriviaQuestion | null {
  const pool = poolFor(index, categories);
  if (pool.length === 0) return null;

  const available = pool.filter((q) => !usedIds.has(q.id) && (accept ? accept(q) : true));
  if (available.length === 0) return null;

  // Prefer in-range questions (distance 0); if none remain, fall to the nearest rating outside it.
  let bestDistance = Infinity;
  let candidates: TriviaQuestion[] = [];
  for (const q of available) {
    const d = distanceToRange(q.difficulty, min, max);
    if (d < bestDistance) {
      bestDistance = d;
      candidates = [q];
    } else if (d === bestDistance) {
      candidates.push(q);
    }
  }
  // When widening lands equidistant below and above the range, break the tie toward the easier
  // (below-range) side - a gentler surprise than the harder one.
  if (bestDistance > 0) {
    const easier = candidates.filter((q) => q.difficulty < min);
    if (easier.length > 0) candidates = easier;
  }
  // rng() is in [0, 1) and candidates is non-empty, so the index is always in bounds.
  return candidates[Math.floor(rng() * candidates.length)]!;
}
