// Liar Liar's payload decoders for the game-pluggable client (spec 0023). The engine streams opaque
// prompt/reveal payloads; the reducer stores them raw (prompt + a `reveals: unknown[]` list) and this
// module decodes the shapes it recognizes at render time. A shape it does not recognize is a null - a
// skipped render, never a throw. A round streams two reveals: first the guessable OPTIONS (during
// `guessing`, no truth tell), then the final RESULT (during `leaderboard`, with the truth and who
// fooled whom), so the pickers scan the list for each.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The clue shown on the viewer while players write their lies. */
export interface LiarLiarPrompt {
  round: number;
  clue: string;
  category: string;
}

export function asLiarLiarPrompt(value: unknown): LiarLiarPrompt | null {
  if (!isRecord(value)) return null;
  const { round, clue, category } = value;
  if (typeof round === 'number' && typeof clue === 'string' && typeof category === 'string') {
    return { round, clue, category };
  }
  return null;
}

/** One guessable option: a stable id and its display text (a fake or the truth). */
export interface LiarLiarOption {
  id: string;
  text: string;
}

/** The guess-phase reveal: every submitted lie plus the truth, shuffled, WITHOUT saying which. */
export interface LiarLiarOptions {
  round: number;
  clue: string;
  options: LiarLiarOption[];
}

function asOption(value: unknown): LiarLiarOption | null {
  if (!isRecord(value)) return null;
  const { id, text } = value;
  return typeof id === 'string' && typeof text === 'string' ? { id, text } : null;
}

export function asLiarLiarOptions(value: unknown): LiarLiarOptions | null {
  if (!isRecord(value)) return null;
  // The options reveal carries no `truth`; that is what distinguishes it from the final result.
  if ('truth' in value) return null;
  const { round, clue, options } = value;
  if (typeof round !== 'number' || typeof clue !== 'string' || !Array.isArray(options)) return null;
  const decoded = options.map(asOption);
  if (decoded.some((o) => o === null)) return null;
  return { round, clue, options: decoded as LiarLiarOption[] };
}

/** One option in the final result: text, whether it was the truth or a fake, its author, and who
 * picked it. */
export interface LiarLiarResultOption {
  id: string;
  text: string;
  kind: 'truth' | 'fake';
  author?: string;
  pickedBy: string[];
}

/** The final reveal: the truth named, every fake attributed to its author with who it fooled, and
 * who guessed right. */
export interface LiarLiarResult {
  round: number;
  clue: string;
  truth: string;
  options: LiarLiarResultOption[];
  correctGuessers: string[];
}

function asResultOption(value: unknown): LiarLiarResultOption | null {
  if (!isRecord(value)) return null;
  const { id, text, kind, author, pickedBy } = value;
  if (typeof id !== 'string' || typeof text !== 'string') return null;
  if (kind !== 'truth' && kind !== 'fake') return null;
  if (!Array.isArray(pickedBy) || pickedBy.some((p) => typeof p !== 'string')) return null;
  return {
    id,
    text,
    kind,
    author: typeof author === 'string' ? author : undefined,
    pickedBy: pickedBy as string[],
  };
}

export function asLiarLiarResult(value: unknown): LiarLiarResult | null {
  if (!isRecord(value)) return null;
  const { round, clue, truth, options, correctGuessers } = value;
  if (
    typeof round !== 'number' ||
    typeof clue !== 'string' ||
    typeof truth !== 'string' ||
    !Array.isArray(options) ||
    !Array.isArray(correctGuessers) ||
    correctGuessers.some((g) => typeof g !== 'string')
  ) {
    return null;
  }
  const decoded = options.map(asResultOption);
  if (decoded.some((o) => o === null)) return null;
  return {
    round,
    clue,
    truth,
    options: decoded as LiarLiarResultOption[],
    correctGuessers: correctGuessers as string[],
  };
}

/** The guessable options in the round's streamed reveals, or null (used during `guessing`). */
export function pickOptions(reveals: readonly unknown[]): LiarLiarOptions | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asLiarLiarOptions(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The final attributed result in the round's streamed reveals, or null (used at `leaderboard`). */
export function pickResult(reveals: readonly unknown[]): LiarLiarResult | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asLiarLiarResult(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
