// Per-round question selection (spec 0008). Given the sampled tier, the chosen category (or all
// categories for `Random`), and the set of ids already used this game, pick one unused question.
// If the sampled tier is exhausted for the category, fall back to the nearest tier; never repeat
// a question within a game.

import type { Difficulty, TriviaQuestion } from '../../question-bank';
import { tiersByProximity } from './difficulty';

/** The sentinel category that draws across all eight categories. */
export const RANDOM_CATEGORY = 'Random';

/** A question bank pre-indexed for O(1) lookup by category+tier; build once per game. */
export interface QuestionIndex {
  /** category -> tier -> questions; `RANDOM_CATEGORY` holds the cross-category pools. */
  readonly byCategoryTier: ReadonlyMap<string, ReadonlyMap<Difficulty, readonly TriviaQuestion[]>>;
  readonly categories: readonly string[];
}

/** Build the category+tier index once, including the cross-category `Random` pools. */
export function indexQuestions(bank: readonly TriviaQuestion[]): QuestionIndex {
  const byCategoryTier = new Map<string, Map<Difficulty, TriviaQuestion[]>>();
  const categories = new Set<string>();

  const put = (category: string, q: TriviaQuestion): void => {
    let tiers = byCategoryTier.get(category);
    if (!tiers) {
      tiers = new Map();
      byCategoryTier.set(category, tiers);
    }
    const bucket = tiers.get(q.difficulty);
    if (bucket) bucket.push(q);
    else tiers.set(q.difficulty, [q]);
  };

  for (const q of bank) {
    categories.add(q.category);
    put(q.category, q);
    put(RANDOM_CATEGORY, q);
  }

  return { byCategoryTier, categories: [...categories] };
}

/**
 * Pick an unused question for `category` at `tier`, falling back to the nearest tier with an
 * unused question when `tier` is drained. Returns `null` only when every tier in the category is
 * exhausted (in practice unreachable: a game runs at most 100 rounds against 200 questions per
 * category, 1600 across `Random`). `rng` selects within the candidate pool so ordering is uniform
 * and deterministic under a seeded rng.
 */
export function pickQuestion(
  index: QuestionIndex,
  category: string,
  tier: Difficulty,
  usedIds: ReadonlySet<string>,
  rng: () => number,
): TriviaQuestion | null {
  const tiers = index.byCategoryTier.get(category);
  if (!tiers) return null;

  for (const candidateTier of tiersByProximity(tier)) {
    const pool = tiers.get(candidateTier);
    if (!pool || pool.length === 0) continue;
    const available = pool.filter((q) => !usedIds.has(q.id));
    if (available.length === 0) continue;
    const choice = available[Math.floor(rng() * available.length)];
    return choice ?? available[0] ?? null;
  }
  return null;
}
