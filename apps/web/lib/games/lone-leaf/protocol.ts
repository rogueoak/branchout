// Lone Leaf's payload decoders for the game-pluggable client (spec 0057). The engine streams opaque
// prompt/reveal payloads plus a per-player private payload (spec 0052); the reducer stores them raw
// and this module decodes the shapes it recognizes at render time. A shape it does not recognize is a
// null - a skipped render, never a throw.
//
// The SECRET seed reaches only non-Seekers, via the private frame (`state.private`); it is NEVER in
// the broadcast prompt or the mid-round reveal, so the Seeker's device can never decode it. A round
// streams two reveals: first the SURVIVORS (during `guessing`, no seed named), then the RESULT (at
// `leaderboard`, with the seed and whether the grove banked it).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The broadcast prompt shown to everyone: the round, the theme, and WHO the Seeker is (no seed). */
export interface LoneLeafPrompt {
  round: number;
  category: string;
  seeker: string;
}

export function asLoneLeafPrompt(value: unknown): LoneLeafPrompt | null {
  if (!isRecord(value)) return null;
  const { round, category, seeker } = value;
  if (typeof round === 'number' && typeof category === 'string' && typeof seeker === 'string') {
    return { round, category, seeker };
  }
  return null;
}

/** The private seed payload delivered ONLY to a non-Seeker (spec 0052). Never reaches the Seeker. */
export interface LoneLeafSecret {
  round: number;
  seed: string;
  category: string;
}

export function asLoneLeafSecret(value: unknown): LoneLeafSecret | null {
  if (!isRecord(value)) return null;
  const { round, seed, category } = value;
  if (typeof round === 'number' && typeof seed === 'string' && typeof category === 'string') {
    return { round, seed, category };
  }
  return null;
}

/** One submitted leaf with its author and whether it survived the wilt. */
export interface LoneLeafLeaf {
  player: string;
  word: string;
  survived: boolean;
}

function asLeaf(value: unknown): LoneLeafLeaf | null {
  if (!isRecord(value)) return null;
  const { player, word, survived } = value;
  if (typeof player === 'string' && typeof word === 'string' && typeof survived === 'boolean') {
    return { player, word, survived };
  }
  return null;
}

/** The mid-round reveal (during `guessing`): the surviving leaves the Seeker guesses from, no seed. */
export interface LoneLeafSurvivors {
  round: number;
  category: string;
  seeker: string;
  survivors: string[];
  leaves: LoneLeafLeaf[];
}

export function asLoneLeafSurvivors(value: unknown): LoneLeafSurvivors | null {
  if (!isRecord(value)) return null;
  // The survivors reveal carries no `seed`; that is what distinguishes it from the final result.
  if ('seed' in value) return null;
  const { round, category, seeker, survivors, leaves } = value;
  if (
    typeof round !== 'number' ||
    typeof category !== 'string' ||
    typeof seeker !== 'string' ||
    !Array.isArray(survivors) ||
    survivors.some((s) => typeof s !== 'string') ||
    !Array.isArray(leaves)
  ) {
    return null;
  }
  const decoded = leaves.map(asLeaf);
  if (decoded.some((l) => l === null)) return null;
  return {
    round,
    category,
    seeker,
    survivors: survivors as string[],
    leaves: decoded as LoneLeafLeaf[],
  };
}

/** The final result (at `leaderboard`): the seed named, the Seeker's guess, and whether it banked. */
export interface LoneLeafResult {
  round: number;
  category: string;
  seeker: string;
  seed: string;
  guess: string;
  correct: boolean;
  survivors: string[];
  leaves: LoneLeafLeaf[];
}

export function asLoneLeafResult(value: unknown): LoneLeafResult | null {
  if (!isRecord(value)) return null;
  const { round, category, seeker, seed, guess, correct, survivors, leaves } = value;
  if (
    typeof round !== 'number' ||
    typeof category !== 'string' ||
    typeof seeker !== 'string' ||
    typeof seed !== 'string' ||
    typeof guess !== 'string' ||
    typeof correct !== 'boolean' ||
    !Array.isArray(survivors) ||
    survivors.some((s) => typeof s !== 'string') ||
    !Array.isArray(leaves)
  ) {
    return null;
  }
  const decoded = leaves.map(asLeaf);
  if (decoded.some((l) => l === null)) return null;
  return {
    round,
    category,
    seeker,
    seed,
    guess,
    correct,
    survivors: survivors as string[],
    leaves: decoded as LoneLeafLeaf[],
  };
}

/** The survivors reveal in the round's streamed reveals, or null (used during `guessing`). */
export function pickSurvivors(reveals: readonly unknown[]): LoneLeafSurvivors | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asLoneLeafSurvivors(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The final result in the round's streamed reveals, or null (used at `leaderboard`). */
export function pickResult(reveals: readonly unknown[]): LoneLeafResult | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asLoneLeafResult(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
