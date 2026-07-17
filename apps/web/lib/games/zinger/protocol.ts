// Zinger's payload decoders for the game-pluggable client (spec 0053). The engine streams opaque
// prompt/reveal payloads; the reducer stores them raw (prompt + a `reveals: unknown[]` list) and this
// module decodes the shapes it recognizes at render time. A shape it does not recognize is a null - a
// skipped render, never a throw. A round streams two reveals: first the FACE-OFF options (during
// `guessing`, no authors, no result fields), then the final RESULT (during `leaderboard`, with authors,
// vote tallies, and the winner), so the pickers scan the list for each.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The setup shown on the viewer while players write their zingers. */
export interface ZingerPrompt {
  round: number;
  setup: string;
}

export function asZingerPrompt(value: unknown): ZingerPrompt | null {
  if (!isRecord(value)) return null;
  const { round, setup } = value;
  if (typeof round === 'number' && typeof setup === 'string' && !('options' in value)) {
    return { round, setup };
  }
  return null;
}

/** One face-off side: a stable id and its zinger text (author hidden during the vote). */
export interface ZingerOption {
  id: string;
  text: string;
}

/** The face-off reveal: the two zingers to vote on, WITHOUT the option->author mapping or tallies.
 * `authorIds` names only WHICH TWO PLAYERS are the contestants (so a remote gates its sit-out on
 * identity, not text) - it is not keyed to the options, so anonymity holds. */
export interface ZingerFaceOff {
  round: number;
  setup: string;
  options: ZingerOption[];
  authorIds: string[];
}

function asOption(value: unknown): ZingerOption | null {
  if (!isRecord(value)) return null;
  const { id, text } = value;
  return typeof id === 'string' && typeof text === 'string' ? { id, text } : null;
}

export function asZingerFaceOff(value: unknown): ZingerFaceOff | null {
  if (!isRecord(value)) return null;
  // The result reveal carries a `winner` field; that is what distinguishes it from the face-off.
  if ('winner' in value) return null;
  const { round, setup, options, authorIds } = value;
  if (typeof round !== 'number' || typeof setup !== 'string' || !Array.isArray(options))
    return null;
  const decoded = options.map(asOption);
  if (decoded.some((o) => o === null)) return null;
  const authors = Array.isArray(authorIds)
    ? authorIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { round, setup, options: decoded as ZingerOption[], authorIds: authors };
}

/** One option in the final result: text, its author, its vote tally, and whether it won. */
export interface ZingerResultOption {
  id: string;
  text: string;
  author?: string;
  votes: number;
  winner: boolean;
}

/** The final reveal: both zingers attributed with tallies, the winner (or null on a tie), and whether
 * it was a clean sweep. */
export interface ZingerResult {
  round: number;
  setup: string;
  options: ZingerResultOption[];
  winner: string | null;
  cleanSweep: boolean;
}

function asResultOption(value: unknown): ZingerResultOption | null {
  if (!isRecord(value)) return null;
  const { id, text, author, votes, winner } = value;
  if (typeof id !== 'string' || typeof text !== 'string') return null;
  if (typeof votes !== 'number' || typeof winner !== 'boolean') return null;
  return {
    id,
    text,
    author: typeof author === 'string' ? author : undefined,
    votes,
    winner,
  };
}

export function asZingerResult(value: unknown): ZingerResult | null {
  if (!isRecord(value)) return null;
  if (!('winner' in value)) return null;
  const { round, setup, options, winner, cleanSweep } = value;
  if (
    typeof round !== 'number' ||
    typeof setup !== 'string' ||
    !Array.isArray(options) ||
    !(winner === null || typeof winner === 'string') ||
    typeof cleanSweep !== 'boolean'
  ) {
    return null;
  }
  const decoded = options.map(asResultOption);
  if (decoded.some((o) => o === null)) return null;
  return {
    round,
    setup,
    options: decoded as ZingerResultOption[],
    winner,
    cleanSweep,
  };
}

/** The face-off options in the round's streamed reveals, or null (used during `guessing`). */
export function pickFaceOff(reveals: readonly unknown[]): ZingerFaceOff | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asZingerFaceOff(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The final attributed result in the round's streamed reveals, or null (used at `leaderboard`). */
export function pickResult(reveals: readonly unknown[]): ZingerResult | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asZingerResult(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
