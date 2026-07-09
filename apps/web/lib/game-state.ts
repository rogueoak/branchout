// The in-game state machine, as a pure reducer over the server frames (spec 0007's
// prompt/reveal/leaderboard/state, plus 0020's answer_rejected). The client is a view over engine
// state: it never runs a timer or tallies a vote - it folds each frame the engine reports into one
// snapshot the UI renders by phase. Keeping this pure (no sockets, no React) makes the whole phase
// machine unit-testable against a list of frames.
//
// The reducer is game-AGNOSTIC (spec 0023): `prompt` and the per-round `reveals` are stored as the
// opaque payloads the engine sends; each game's UI module decodes them at render time (a shape the
// module does not understand is a null, a skipped render, never a thrown one). This is the same
// "opaque payload, the game owns the shape" contract the engine already uses.

import type { Phase, PlayerView, ServerMessage, Standing } from '@branchout/protocol';

/** How the socket layer is doing, surfaced so the UI can show a reconnect banner. */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** One immutable snapshot of the game the UI renders. */
export interface GameState {
  connection: ConnectionStatus;
  /** True once at least one `state` frame has arrived (we know the real phase). */
  joined: boolean;
  phase: Phase;
  paused: boolean;
  round: number;
  players: PlayerView[];
  scores: Record<string, number>;
  /** The playerIds under dispute this round - the exact set the vote UI offers a ballot on. */
  disputes: string[];
  /**
   * Milliseconds left in the answer window as of the last `state` frame, or null when there is no
   * timer (spec 0017). A countdown hook anchors this to the local clock; while paused it is the
   * frozen remaining.
   */
  answerMsRemaining: number | null;
  /** The current round's opaque prompt payload, or null before the first prompt / between rounds. */
  prompt: unknown;
  /**
   * Every opaque reveal payload the engine streamed for the CURRENT round, in arrival order, cleared
   * when the next prompt lands. A round can stream more than one reveal (Trivia's answer reveal then
   * its dispute outcome; Liar Liar's options then its final result), so the module decodes the list
   * and picks the shapes it needs rather than reading a single last-write-wins slot.
   */
  reveals: unknown[];
  /** The latest standings - the between-round leaderboard and the final results. */
  standings: Standing[];
  /**
   * The reason the engine rejected this device's last submission (spec 0020's `answer_rejected`), or
   * null. Set on the targeted reject frame, cleared on the next prompt. The remote clears it too on a
   * fresh submit; a game that never rejects leaves it null.
   */
  rejected: string | null;
  /** The last protocol error frame, if any. */
  error: string | null;
}

export function initialGameState(): GameState {
  return {
    connection: 'connecting',
    joined: false,
    phase: 'configuring',
    paused: false,
    round: 0,
    players: [],
    scores: {},
    disputes: [],
    answerMsRemaining: null,
    prompt: null,
    reveals: [],
    standings: [],
    rejected: null,
    error: null,
  };
}

/** The frames the reducer folds outside the game lifecycle: an error, and a targeted reject. */
interface ErrorFrame {
  type: 'error';
  message: string;
}
interface AnswerRejectedFrame {
  type: 'answer_rejected';
  round: number;
  reason: string;
}

/** Fold one server frame into the state. Returns a new object; never mutates the input. */
export function reduceGameState(
  state: GameState,
  frame: ServerMessage | ErrorFrame | AnswerRejectedFrame,
): GameState {
  switch (frame.type) {
    case 'state':
      return {
        ...state,
        joined: true,
        phase: frame.phase,
        paused: frame.paused,
        round: frame.round,
        players: frame.players,
        scores: frame.scores,
        // Default at the boundary: a `state` frame from a peer predating the `disputes` field
        // (same PROTOCOL_VERSION, additive change) omits it, and "absent" means "no disputers".
        disputes: frame.disputes ?? [],
        // Absent when there is no answer timer (or a pre-0017 peer); null means "no countdown".
        answerMsRemaining: frame.answerMsRemaining ?? null,
        error: null,
      };

    case 'prompt':
      // A new prompt opens a fresh round: store the opaque prompt and clear the prior round's
      // reveals, standings, and any stale rejection so nothing bleeds into the new question.
      return {
        ...state,
        round: frame.round,
        phase: frame.phase,
        prompt: frame.prompt,
        reveals: [],
        standings: [],
        rejected: null,
      };

    case 'reveal':
      // Accumulate the opaque reveal payload; the module decodes the list. (One round can stream
      // several reveals - the module reads whichever shapes it recognizes.)
      return { ...state, reveals: [...state.reveals, frame.reveal] };

    case 'leaderboard':
      return { ...state, standings: frame.standings };

    case 'answer_rejected':
      return { ...state, rejected: frame.reason };

    case 'error':
      return { ...state, error: frame.message };

    default:
      return state;
  }
}

/** Set just the connection status (the socket layer drives this, not a server frame). */
export function withConnection(state: GameState, connection: ConnectionStatus): GameState {
  return { ...state, connection };
}

/** Clear a stale rejection locally (the remote calls this when the player submits again). */
export function clearRejected(state: GameState): GameState {
  return state.rejected === null ? state : { ...state, rejected: null };
}

/** True when the game has finished and the final standings are ready to show. */
export function isComplete(state: GameState): boolean {
  return state.phase === 'complete';
}

/**
 * Platform-default stars for a final rank, mirroring the control-plane's `starsForRank` (spec
 * 0006): win 3, second 2, third 1, nothing below. The control-plane is the authority that records
 * stars; this mirror is display-only, so the final screen can show them without another round trip.
 */
export function starsForRank(rank: number): number {
  if (rank === 1) return 3;
  if (rank === 2) return 2;
  if (rank === 3) return 1;
  return 0;
}
