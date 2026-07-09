// The in-game state machine, as a pure reducer over the server frames (spec 0007's
// prompt/reveal/leaderboard/state). The client is a view over engine state: it never runs the
// dispute timer or tallies a vote - it folds each frame the engine reports into one snapshot the
// UI renders by phase. Keeping this pure (no sockets, no React) makes the whole phase machine
// unit-testable against a list of frames.

import type { Phase, PlayerView, ServerMessage, Standing } from '@branchout/protocol';
import {
  asTriviaDisputeReveal,
  asTriviaPrompt,
  asTriviaRoundReveal,
  type TriviaDisputeReveal,
  type TriviaPrompt,
  type TriviaRoundReveal,
} from './game-protocol';

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
  /** The current round's prompt, or null before the first prompt / between rounds. */
  prompt: TriviaPrompt | null;
  /** The answer-round reveal, set on reveal and cleared when the next prompt lands. */
  reveal: TriviaRoundReveal | null;
  /** The post-dispute outcome, set after voting resolves. */
  disputeResult: TriviaDisputeReveal | null;
  /** The latest standings - the between-round leaderboard and the final results. */
  standings: Standing[];
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
    reveal: null,
    disputeResult: null,
    standings: [],
    error: null,
  };
}

/** An error frame is the one server frame the reducer folds outside the game lifecycle. */
interface ErrorFrame {
  type: 'error';
  message: string;
}

/** Fold one server frame into the state. Returns a new object; never mutates the input. */
export function reduceGameState(state: GameState, frame: ServerMessage | ErrorFrame): GameState {
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

    case 'prompt': {
      const prompt = asTriviaPrompt(frame.prompt);
      // A new prompt opens a fresh round: clear the prior reveal, dispute outcome, and standings so
      // stale results never bleed into the new question.
      return {
        ...state,
        round: frame.round,
        phase: frame.phase,
        prompt: prompt ?? state.prompt,
        reveal: null,
        disputeResult: null,
        standings: [],
      };
    }

    case 'reveal': {
      // Trivia sends two reveal shapes on the same frame: the answer-round reveal (correct/wrong)
      // and the post-dispute reveal (upheld). Decode which one this is.
      const round = asTriviaRoundReveal(frame.reveal);
      if (round) {
        return { ...state, reveal: round };
      }
      const dispute = asTriviaDisputeReveal(frame.reveal);
      if (dispute) {
        return { ...state, disputeResult: dispute };
      }
      return state;
    }

    case 'leaderboard':
      return { ...state, standings: frame.standings };

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
