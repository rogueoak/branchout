// The contract every game plugs into. The engine (the harness) owns phase sequencing, timers (e.g.
// the dispute window), streaming, and host-control application; a game module owns what each phase
// *means*. This split lets a game be pure game logic and keeps the registry the only place games
// attach.
//
// The generic round lifecycle the engine drives:
//   configure -> startRound -> collectAnswers -> reveal/score -> disputeWindow -> disputeVote ->
//   leaderboard -> advance   (repeat per round), plus endGame.
//
// A module is a set of pure callbacks over a `RoundContext`: it reads the session and returns the
// state to persist plus what to stream and score. Keeping the callbacks pure (no I/O, no hidden
// state) makes games trivial to unit test and lets the engine own all persistence.

import type { Phase, PlayerView, ScoreEvent, Standing } from '@branchout/protocol';

/**
 * A player in a session: identity, display name, and live connection state, plus whether they are
 * the room host (the engine auto-pauses while the host is disconnected - spec 0014). `isHost` is
 * engine-internal; it is not projected onto the wire `state` frame's `players`.
 */
export type SessionPlayer = PlayerView & { isHost?: boolean };

/** What a module reads for a round. `scratch` is the module's own persisted state. */
export interface RoundContext {
  room: string;
  game: string;
  phase: Phase;
  round: number;
  players: readonly SessionPlayer[];
  scores: Readonly<Record<string, number>>;
  scratch: Readonly<Record<string, unknown>>;
  config: unknown;
}

/** A vote frame routed to the module: raising a dispute (`disputing`) or a ballot (`voting`). */
export interface VoteInput {
  player: string;
  target: string;
  agree: boolean;
}

export interface ConfigureResult {
  scratch: Record<string, unknown>;
  /** Total rounds this game runs. Must be >= 1. */
  rounds: number;
  /** Dispute-window duration in ms. 0 (default) means the host advances it manually. */
  disputeWindowMs?: number;
  /**
   * Answer-window duration in ms: the engine force-closes the answer round to reveal when it
   * expires (spec 0017). 0 (default) means no timer - the round waits on all-answered or the host.
   */
  answerWindowMs?: number;
}

export interface StartRoundResult {
  scratch: Record<string, unknown>;
  /** Opaque, game-defined prompt payload streamed to devices. */
  prompt: unknown;
}

export interface RevealResult {
  scratch: Record<string, unknown>;
  /** Opaque, game-defined reveal payload streamed to devices. */
  reveal: unknown;
  /** Points awarded this reveal. The engine applies and reports them. */
  scores: ScoreEvent[];
}

export interface DisputeWindowResult {
  scratch: Record<string, unknown>;
  /** Players whose results are disputed and go to a vote. Empty skips the voting phase. */
  disputes: string[];
}

export interface DisputeVoteResult {
  scratch: Record<string, unknown>;
  /** Extra points from upheld disputes. */
  scores: ScoreEvent[];
  /** Optional updated reveal payload after disputes resolve. */
  reveal?: unknown;
}

export interface AdvanceResult {
  /** True when the game is over and the engine should end it. */
  done: boolean;
}

/** A callback that only mutates the module's scratch (collecting answers and votes). */
export interface ScratchResult {
  scratch: Record<string, unknown>;
}

export interface GameModule {
  /** Stable id the registry resolves and the start handoff selects. */
  readonly id: string;

  /** Validate + normalize the opaque config; decide the round count. Throws on invalid config. */
  configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult;

  /** Produce the prompt for a round. */
  startRound(ctx: RoundContext): StartRoundResult;

  /** Record one player's answer for the current round. */
  collectAnswer(ctx: RoundContext, player: string, answer: string): ScratchResult;

  /**
   * True when the current answer round is complete - every connected player has submitted - so the
   * engine can auto-close it after a short grace period instead of waiting on a host tap. The engine
   * asks after each answer *and* when a player disconnects (a drop can complete the round for the
   * remaining players). Optional: a game that omits it never auto-advances and relies on the host.
   */
  allAnswered?(ctx: RoundContext): boolean;

  /** Score the round and produce the reveal payload. */
  reveal(ctx: RoundContext): RevealResult;

  /** Record one vote (a dispute-raise while `disputing`, a ballot while `voting`). */
  collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult;

  /** Close the dispute window: which results, if any, go to a vote. */
  disputeWindow(ctx: RoundContext): DisputeWindowResult;

  /** Tally dispute votes and award any upheld points. */
  disputeVote(ctx: RoundContext): DisputeVoteResult;

  /** The standings to show between rounds. */
  leaderboard(ctx: RoundContext): Standing[];

  /** After the leaderboard: is the game done, or is there another round? */
  advance(ctx: RoundContext): AdvanceResult;

  /** Final ranked standings when the game ends. */
  endGame(ctx: RoundContext): Standing[];
}
