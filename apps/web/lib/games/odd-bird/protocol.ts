// Odd Bird's payload decoders for the game-pluggable client (spec 0023). The engine streams opaque
// prompt/reveal payloads AND a per-player `private` payload (spec 0052); the reducer stores them raw
// and this module decodes the shapes it recognizes at render time. A shape it does not recognize is a
// null - a skipped render, never a throw. The round streams: the public prompt (no secret), a flush
// reveal (the accusable players + the roost slate the odd bird guesses from), then the final result.
// The SECRET card (roost + perch, or "you are the odd bird") arrives ONLY on `state.private`.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** The public prompt shown while the flock questions each other. Carries NO secret. */
export interface OddBirdPrompt {
  round: number;
  players: number;
  category: string;
}

export function asOddBirdPrompt(value: unknown): OddBirdPrompt | null {
  if (!isRecord(value)) return null;
  const { round, players, category } = value;
  if (typeof round === 'number' && typeof players === 'number' && typeof category === 'string') {
    return { round, players, category };
  }
  return null;
}

/** This device's OWN private card - the only place a secret ever lands (spec 0052). */
export type OddBirdCard = { role: 'flock'; roost: string; perch: string } | { role: 'odd-bird' };

export function asOddBirdCard(value: unknown): OddBirdCard | null {
  if (!isRecord(value)) return null;
  if (value.role === 'odd-bird') return { role: 'odd-bird' };
  if (
    value.role === 'flock' &&
    typeof value.roost === 'string' &&
    typeof value.perch === 'string'
  ) {
    return { role: 'flock', roost: value.roost, perch: value.perch };
  }
  return null;
}

/** One roost the odd bird may guess from at the flush. */
export interface OddBirdRoostOption {
  id: string;
  name: string;
}

function asRoostOption(value: unknown): OddBirdRoostOption | null {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
}

/** The flush reveal: who can be accused and the roost slate the odd bird picks from. No secret. */
export interface OddBirdFlush {
  round: number;
  players: string[];
  roostOptions: OddBirdRoostOption[];
}

export function asOddBirdFlush(value: unknown): OddBirdFlush | null {
  if (!isRecord(value)) return null;
  // The flush carries no `roost` (the truth); that is what distinguishes it from the final result.
  if ('roost' in value) return null;
  const { round, players, roostOptions } = value;
  if (typeof round !== 'number' || !isStringArray(players) || !Array.isArray(roostOptions)) {
    return null;
  }
  const decoded = roostOptions.map(asRoostOption);
  if (decoded.some((o) => o === null)) return null;
  return { round, players, roostOptions: decoded as OddBirdRoostOption[] };
}

/** The final result: the roost named, who the odd bird was, and how the flush landed. */
export interface OddBirdResult {
  round: number;
  roost: string;
  oddBird: string;
  flushed: string | null;
  guessedRoost: boolean;
  guessedName: string | null;
  flockWon: boolean;
  accusations: Record<string, string>;
}

export function asOddBirdResult(value: unknown): OddBirdResult | null {
  if (!isRecord(value)) return null;
  const { round, roost, oddBird, flushed, guessedRoost, guessedName, flockWon, accusations } =
    value;
  if (
    typeof round !== 'number' ||
    typeof roost !== 'string' ||
    typeof oddBird !== 'string' ||
    (flushed !== null && typeof flushed !== 'string') ||
    typeof guessedRoost !== 'boolean' ||
    (guessedName !== null && typeof guessedName !== 'string') ||
    typeof flockWon !== 'boolean' ||
    !isRecord(accusations)
  ) {
    return null;
  }
  const accs: Record<string, string> = {};
  for (const [k, v] of Object.entries(accusations)) {
    if (typeof v !== 'string') return null;
    accs[k] = v;
  }
  return {
    round,
    roost,
    oddBird,
    flushed: flushed as string | null,
    guessedRoost,
    guessedName: guessedName as string | null,
    flockWon,
    accusations: accs,
  };
}

/** The flush reveal in the round's streamed reveals, or null (used during `guessing`). */
export function pickFlush(reveals: readonly unknown[]): OddBirdFlush | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asOddBirdFlush(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}

/** The final result in the round's streamed reveals, or null (used at `leaderboard`/`complete`). */
export function pickResult(reveals: readonly unknown[]): OddBirdResult | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asOddBirdResult(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
