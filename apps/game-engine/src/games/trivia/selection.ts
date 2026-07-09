// Per-round question selection (spec 0008, difficulty range spec 0016). Given the host's difficulty
// range [min, max], the chosen category (or all categories for `Random`), and the ids already used
// this game, pick one unused question whose rating falls in the range. If the range is exhausted for
// the category, widen to the nearest rating outside it; never repeat a question within a game.

import type { TriviaQuestion } from './question-bank';

/** The sentinel category that draws across all eight categories. */
export const RANDOM_CATEGORY = 'Random';

/** A question bank pre-indexed by category for O(1) pool lookup; build once per game. */
export interface QuestionIndex {
  /** category -> its questions; `RANDOM_CATEGORY` holds the cross-category pool. */
  readonly byCategory: ReadonlyMap<string, readonly TriviaQuestion[]>;
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
 * Pick an unused question for `category` whose rating is in [min, max]. When the range holds no
 * unused question, widen to the nearest rating outside it (a smaller surprise than jumping to an
 * extreme); a below/above tie breaks toward the easier (lower) rating. Returns `null` only when
 * every question in the category is used - in practice unreachable: a game runs at most 100 rounds
 * against 200 questions per category. `rng` selects within the candidate pool so ordering is
 * uniform and deterministic under a seeded rng.
 */
export function pickQuestion(
  index: QuestionIndex,
  category: string,
  min: number,
  max: number,
  usedIds: ReadonlySet<string>,
  rng: () => number,
): TriviaQuestion | null {
  const pool = index.byCategory.get(category);
  if (!pool) return null;

  const available = pool.filter((q) => !usedIds.has(q.id));
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
