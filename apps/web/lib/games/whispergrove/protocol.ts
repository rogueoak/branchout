// Whispergrove's client-boundary decoders (spec 0062, spec 0023). Whispergrove is a LIVE game: the
// engine streams a WhispergroveSim on the `sim` frame (the shared grove everyone sees) and delivers
// the SECRET key to the two Whisperers ONLY on the `private` frame. The web is a pure renderer that
// decodes these opaque `unknown` payloads here. A shape the renderer does not understand decodes to
// null (a skipped render), never a throw - the same "opaque payload, the game owns the shape" contract
// the engine uses. These types mirror packages/games/whispergrove/src/types.ts; keep them in lockstep.

/** The two groves. Violet starts (it holds the 9-leaf majority). */
export type Team = 'violet' | 'amber';

/** A leaf's true role, only ever shown once revealed. */
export type LeafRole = 'violet' | 'amber' | 'sapling' | 'deadwood';

/** A player's seat role. */
export type SeatRole = 'whisperer' | 'seeker';

export type WhispergrovePhase = 'whispering' | 'guessing' | 'over';
export type WhispergroveEndReason = 'cleared' | 'deadwood';

/** A single leaf as everyone sees it (the secret role of a hidden leaf is null). */
export interface PublicLeaf {
  index: number;
  word: string;
  revealed: boolean;
  shown: LeafRole | null;
}

/** The current whisper (clue): one word + a count, from the active grove. */
export interface Whisper {
  word: string;
  count: number;
  team: Team;
}

/** One player's public seat (team + role). The key is never in here. */
export interface SeatAssignment {
  player: string;
  team: Team;
  role: SeatRole;
}

/** The broadcast snapshot everyone sees (no secret key). */
export interface WhispergroveSim {
  leaves: PublicLeaf[];
  turn: Team;
  phase: WhispergrovePhase;
  whisper: Whisper | null;
  guessesLeft: number;
  violetLeft: number;
  amberLeft: number;
  winner: Team | null;
  endReason: WhispergroveEndReason | null;
  seats: SeatAssignment[];
}

/** The per-Whisperer SECRET payload (spec 0052): the true role of every leaf. */
export interface WhispererSecret {
  key: LeafRole[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isTeam(value: unknown): value is Team {
  return value === 'violet' || value === 'amber';
}
function isRole(value: unknown): value is LeafRole {
  return value === 'violet' || value === 'amber' || value === 'sapling' || value === 'deadwood';
}

function asLeaf(value: unknown): PublicLeaf | null {
  if (!isRecord(value)) return null;
  if (
    !isNum(value.index) ||
    typeof value.word !== 'string' ||
    typeof value.revealed !== 'boolean'
  ) {
    return null;
  }
  const shown = value.shown === null ? null : isRole(value.shown) ? value.shown : undefined;
  if (shown === undefined) return null;
  return { index: value.index, word: value.word, revealed: value.revealed, shown };
}

function asLeaves(value: unknown): PublicLeaf[] | null {
  if (!Array.isArray(value)) return null;
  const out: PublicLeaf[] = [];
  for (const item of value) {
    const leaf = asLeaf(item);
    if (!leaf) return null;
    out.push(leaf);
  }
  return out;
}

function asWhisper(value: unknown): Whisper | null {
  if (!isRecord(value)) return null;
  if (typeof value.word !== 'string' || !isNum(value.count) || !isTeam(value.team)) return null;
  return { word: value.word, count: value.count, team: value.team };
}

function asSeats(value: unknown): SeatAssignment[] | null {
  if (!Array.isArray(value)) return null;
  const out: SeatAssignment[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (
      typeof item.player !== 'string' ||
      !isTeam(item.team) ||
      (item.role !== 'whisperer' && item.role !== 'seeker')
    ) {
      return null;
    }
    out.push({ player: item.player, team: item.team, role: item.role });
  }
  return out;
}

/** Decode a `sim` payload as a Whispergrove snapshot, or null if it is not one. */
export function asWhispergroveSim(value: unknown): WhispergroveSim | null {
  if (!isRecord(value)) return null;
  const leaves = asLeaves(value.leaves);
  const seats = asSeats(value.seats);
  const whisper = value.whisper === null ? null : asWhisper(value.whisper);
  const whisperOk = value.whisper === null || whisper !== null;
  const winner = value.winner === null ? null : isTeam(value.winner) ? value.winner : undefined;
  const endReason =
    value.endReason === null
      ? null
      : value.endReason === 'cleared' || value.endReason === 'deadwood'
        ? value.endReason
        : undefined;
  if (
    leaves &&
    seats &&
    whisperOk &&
    winner !== undefined &&
    endReason !== undefined &&
    isTeam(value.turn) &&
    (value.phase === 'whispering' || value.phase === 'guessing' || value.phase === 'over') &&
    isNum(value.guessesLeft) &&
    isNum(value.violetLeft) &&
    isNum(value.amberLeft)
  ) {
    return {
      leaves,
      turn: value.turn,
      phase: value.phase,
      whisper,
      guessesLeft: value.guessesLeft,
      violetLeft: value.violetLeft,
      amberLeft: value.amberLeft,
      winner,
      endReason,
      seats,
    };
  }
  return null;
}

/** Decode the Whisperer's private secret (the full key), or null if it is not one. */
export function asWhispererSecret(value: unknown): WhispererSecret | null {
  if (!isRecord(value) || !Array.isArray(value.key)) return null;
  const key: LeafRole[] = [];
  for (const role of value.key) {
    if (!isRole(role)) return null;
    key.push(role);
  }
  return { key };
}

/** The local player's seat in a sim, or undefined if they are not seated (a viewer/host). */
export function seatOf(sim: WhispergroveSim, me: string | undefined): SeatAssignment | undefined {
  return me ? sim.seats.find((s) => s.player === me) : undefined;
}
