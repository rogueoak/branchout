// Same Branch payload decoders for the game-pluggable client (spec 0023). The engine streams opaque
// prompt/reveal payloads and a per-player `private` secret (spec 0052); the reducer stores them raw and
// this module decodes the shapes it recognizes at render time. A shape it does not recognize is a null
// - a skipped render, never a throw.
//
// The bud (the hidden target) is NEVER in the broadcast prompt; it arrives only in the Reader's
// `private` payload (`asSameBranchSecret`) and is disclosed to everyone in the `reveal`.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The round prompt everyone sees: the branch ends and who the Reader is - but NO bud. */
export interface SameBranchPrompt {
  round: number;
  category: string;
  left: string;
  right: string;
  reader: string;
}

export function asSameBranchPrompt(value: unknown): SameBranchPrompt | null {
  if (!isRecord(value)) return null;
  const { round, category, left, right, reader } = value;
  if (
    typeof round === 'number' &&
    typeof category === 'string' &&
    typeof left === 'string' &&
    typeof right === 'string' &&
    typeof reader === 'string'
  ) {
    return { round, category, left, right, reader };
  }
  return null;
}

/** The Reader's private secret for the round: the hidden bud position and the ends it sits between. */
export interface SameBranchSecret {
  round: number;
  bud: number;
  left: string;
  right: string;
}

export function asSameBranchSecret(value: unknown): SameBranchSecret | null {
  if (!isRecord(value)) return null;
  const { round, bud, left, right } = value;
  if (
    typeof round === 'number' &&
    typeof bud === 'number' &&
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    return { round, bud, left, right };
  }
  return null;
}

/** One guesser's result in the reveal: where they landed, the points, and the closeness band. */
export interface SameBranchGuessResult {
  player: string;
  position: number;
  points: number;
  band: string;
}

/** The reveal: the bud disclosed, the Reader's hunch, and every guess scored by closeness. */
export interface SameBranchReveal {
  round: number;
  category: string;
  left: string;
  right: string;
  reader: string;
  hunch: string;
  bud: number;
  mode: string;
  guesses: SameBranchGuessResult[];
}

function asGuessResult(value: unknown): SameBranchGuessResult | null {
  if (!isRecord(value)) return null;
  const { player, position, points, band } = value;
  if (
    typeof player === 'string' &&
    typeof position === 'number' &&
    typeof points === 'number' &&
    typeof band === 'string'
  ) {
    return { player, position, points, band };
  }
  return null;
}

export function asSameBranchReveal(value: unknown): SameBranchReveal | null {
  if (!isRecord(value)) return null;
  const { round, category, left, right, reader, hunch, bud, mode, guesses } = value;
  if (
    typeof round !== 'number' ||
    typeof category !== 'string' ||
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    typeof reader !== 'string' ||
    typeof hunch !== 'string' ||
    typeof bud !== 'number' ||
    typeof mode !== 'string' ||
    !Array.isArray(guesses)
  ) {
    return null;
  }
  const decoded = guesses.map(asGuessResult);
  if (decoded.some((g) => g === null)) return null;
  return {
    round,
    category,
    left,
    right,
    reader,
    hunch,
    bud,
    mode,
    guesses: decoded as SameBranchGuessResult[],
  };
}

/** The latest reveal in the round's streamed reveals, or null (used at `leaderboard`). */
export function pickReveal(reveals: readonly unknown[]): SameBranchReveal | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asSameBranchReveal(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
