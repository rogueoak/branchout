// Whispergrove wire + state types (spec 0062). The grid is "the Grove": 25 word tiles ("leaves").
// A secret KEY assigns each leaf a true role (own team / other team / a sapling / the Deadwood); the
// key is delivered ONLY to the two Whisperers via the spec 0052 private channel and is NEVER part of
// the broadcast `sim`. The broadcast `sim` carries only what everyone may see: the words, which
// leaves are already revealed (and to which team), whose turn it is, and the current whisper.

/** The two groves (teams). Violet grove starts (it has the 9-leaf majority). */
export type Team = 'violet' | 'amber';

/**
 * The true role of a leaf, from the secret key. `violet`/`amber` are that team's leaves; `sapling`
 * is a neutral leaf; `deadwood` is the single instant-loss leaf. Only a Whisperer ever sees this.
 */
export type LeafRole = 'violet' | 'amber' | 'sapling' | 'deadwood';

/** A player's assigned seat role: the grove's clue-giver, or one of its seekers. */
export type SeatRole = 'whisperer' | 'seeker';

/** A single leaf as everyone sees it on the shared Grove (no secret role here). */
export interface PublicLeaf {
  /** 0..24 index into the 5x5 grove (row-major). */
  index: number;
  /** The single-noun word printed on the leaf. */
  word: string;
  /** True once this leaf has been tapped and its role shown to all. */
  revealed: boolean;
  /** The role uncovered when it was revealed, or null while still hidden. */
  shown: LeafRole | null;
}

/** The current whisper (clue): one word plus a count, from the active Whisperer. */
export interface Whisper {
  /** The single-token clue word. */
  word: string;
  /** How many leaves the Whisperer says it links (1..9). */
  count: number;
  /** The grove that gave the whisper. */
  team: Team;
}

/**
 * The broadcast snapshot (the `sim` frame): everything every device may see. The secret key is NOT
 * here - it rides the private channel to the two Whisperers only. The web decodes this opaque payload
 * at the client boundary (protocol.ts) and renders the grove from it.
 */
export interface WhispergroveSim {
  /** The 25 leaves in grid order, each with its word + revealed state. */
  leaves: PublicLeaf[];
  /** Whose turn it is (the grove currently guessing / whispering). */
  turn: Team;
  /**
   * The phase within a turn: `'whispering'` waits on the active grove's Whisperer to submit a
   * whisper; `'guessing'` waits on that grove's seekers to tap leaves; `'over'` once the game ended.
   */
  phase: WhispergrovePhase;
  /** The active whisper while guessing, or null while waiting on a whisper. */
  whisper: Whisper | null;
  /** Taps the active grove has left this turn (starts at whisper.count + 1). 0 outside guessing. */
  guessesLeft: number;
  /** How many of each grove's leaves are still hidden - the race both groves see. */
  violetLeft: number;
  amberLeft: number;
  /** The winning grove once the game is over, or null while playing. */
  winner: Team | null;
  /**
   * Why the game ended, for the end banner: `'cleared'` (a grove revealed all its leaves) or
   * `'deadwood'` (a grove woke the Deadwood and fell). Null while playing.
   */
  endReason: WhispergroveEndReason | null;
  /** Per-player seat assignments (team + role), so a device can render its own badge + gate input. */
  seats: SeatAssignment[];
}

export type WhispergrovePhase = 'whispering' | 'guessing' | 'over';
export type WhispergroveEndReason = 'cleared' | 'deadwood';

/** One player's public seat: which grove and role. The KEY is never in here. */
export interface SeatAssignment {
  player: string;
  team: Team;
  role: SeatRole;
}

/**
 * The per-Whisperer SECRET payload (spec 0052 private channel): the true role of every leaf. Only the
 * two Whisperers receive this; it is never broadcast. Both Whisperers see the same full key.
 */
export interface WhispererSecret {
  /** The true role of each leaf, indexed 0..24 (parallel to `sim.leaves`). */
  key: LeafRole[];
}

/**
 * A move a client submits (as the `move` string, JSON-encoded). A Whisperer sends a `whisper`; a
 * seeker sends a `tap`. The engine validates the sender's seat + the turn + guesses-left.
 */
export type WhispergroveMove =
  { kind: 'whisper'; word: string; count: number } | { kind: 'tap'; index: number };
