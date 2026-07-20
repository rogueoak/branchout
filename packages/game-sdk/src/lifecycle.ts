// The contract every game plugs into. The engine (the harness) owns phase sequencing, timers (e.g.
// the dispute window), streaming, and host-control application; a game module owns what each phase
// *means*. This split lets a game be pure game logic and keeps the registry the only place games
// attach.
//
// The generic round lifecycle the engine drives:
//   configure -> startRound -> collectMove -> reveal/score -> disputeWindow -> disputeVote ->
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
   * Move-window duration in ms: the engine force-closes the move round to reveal when it
   * expires (spec 0017). 0 (default) means no timer - the round waits on all-submitted or the host.
   */
  moveWindowMs?: number;
  /**
   * Leaderboard-window duration in ms (spec 0068): after this delay the engine advances the
   * `leaderboard` phase to the next round (or ends the game). 0 (default) means the host advances the
   * leaderboard manually, so a game that never sets it keeps today's host-driven pacing. Named for the
   * phase it drives, like its `moveWindowMs`/`disputeWindowMs` siblings.
   */
  leaderboardWindowMs?: number;
}

export interface StartRoundResult {
  scratch: Record<string, unknown>;
  /** Opaque, game-defined prompt payload streamed to devices. */
  prompt: unknown;
  /**
   * Per-player secret payloads for this frame: playerId -> that player's opaque private data. The
   * engine delivers each entry ONLY to that player's device(s) (never broadcast), persists the latest
   * per player for join catch-up, and clears it when the next round starts. A player absent from the
   * map simply has no secret this frame. Optional and additive: a game that never sets it is
   * unaffected.
   */
  private?: Record<string, unknown>;
}

export interface RevealResult {
  scratch: Record<string, unknown>;
  /** Opaque, game-defined reveal payload streamed to devices. */
  reveal: unknown;
  /** Points awarded this reveal. The engine applies and reports them. */
  scores: ScoreEvent[];
  /**
   * When present, the engine runs a generic post-reveal *guess* phase instead of the dispute path:
   * it streams this reveal as the guessable options, collects choices via the `vote` frame, closes
   * on all-decided or after `windowMs`, then calls {@link GameModule.resolveDecision} to score. A
   * game that omits this (e.g. Trivia) takes the unchanged `disputing -> voting` path. Additive and
   * opt-in - the two post-reveal shapes never mix in one game.
   */
  decision?: { windowMs?: number };
  /**
   * Per-player secret payloads for this frame: playerId -> that player's opaque private data. The
   * engine delivers each entry ONLY to that player's device(s) (never broadcast), persists the latest
   * per player for join catch-up, and clears it when the next round starts. A player absent from the
   * map simply has no secret this frame. Optional and additive: a game that never sets it is
   * unaffected.
   */
  private?: Record<string, unknown>;
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

/**
 * One live tick of a continuous ("live") game (spec 0044). A live game - one whose module implements
 * {@link GameModule.tick} - owns a world (a physics tower) the engine steps on a fixed cadence and
 * streams as a `sim` frame, instead of the discrete collect -> reveal -> advance turn cycle. Its
 * `collectMove` doubles as "apply this move to the live world" (add the dropped piece) rather than
 * staging a pending answer.
 */
export interface LiveTickResult {
  /** The serializable snapshot to persist, so the world can be rebuilt after a reconnect/restart. */
  scratch: Record<string, unknown>;
  /** The opaque `sim` payload to broadcast this tick, or null to broadcast nothing (fully idle). */
  sim: unknown;
  /** True when the game is over; the engine ends it and stops the sim loop. */
  over: boolean;
  /**
   * Per-player secret payloads for this frame: playerId -> that player's opaque private data. The
   * engine delivers each entry ONLY to that player's device(s) (never broadcast), persists the latest
   * per player for join catch-up, and clears it when the next round starts. A player absent from the
   * map simply has no secret this frame. Optional and additive: a game that never sets it is
   * unaffected. For a live game whose secret can change (a shifting private hand), re-emit it here so
   * the update re-sends.
   */
  private?: Record<string, unknown>;
}

/** The result of resolving a guess phase: scores to apply and an optional final reveal. */
export interface DecisionResult {
  scratch: Record<string, unknown>;
  /** Points awarded when the guess phase resolves (e.g. a correct guess, a fooled author). */
  scores: ScoreEvent[];
  /** Optional updated reveal payload after the guesses resolve (who guessed what, the truth). */
  reveal?: unknown;
}

/**
 * A callback that only mutates the module's scratch (collecting moves and votes). `rejected`, when
 * set by {@link GameModule.collectMove}, tells the engine to refuse this one submission: it writes
 * no scratch and replies to the submitting device alone with the reason (never a broadcast).
 */
export interface ScratchResult {
  scratch: Record<string, unknown>;
  rejected?: { reason: string };
}

export interface GameModule {
  /** Stable id the registry resolves and the start handoff selects. */
  readonly id: string;

  /** Validate + normalize the opaque config; decide the round count. Throws on invalid config. */
  configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult;

  /** Produce the prompt for a round. */
  startRound(ctx: RoundContext): StartRoundResult;

  /** Record one player's move for the current round. */
  collectMove(ctx: RoundContext, player: string, move: string): ScratchResult;

  /**
   * True when the current move round is complete - every connected player has submitted - so the
   * engine can auto-close it after a short grace period instead of waiting on a host tap. The engine
   * asks after each move *and* when a player disconnects (a drop can complete the round for the
   * remaining players). Optional: a game that omits it never auto-advances and relies on the host.
   */
  allSubmitted?(ctx: RoundContext): boolean;

  /**
   * How many connected players have submitted an answer this round (spec 0069), so the engine can
   * surface a live "x of y answered" count on the `state` frame while `collecting`. Optional: a game
   * that omits it reports no count (the field is absent on the wire). Distinct from
   * {@link allSubmitted}, which is only the all-in boolean.
   */
  answeredCount?(ctx: RoundContext): number;

  /** Score the round and produce the reveal payload. */
  reveal(ctx: RoundContext): RevealResult;

  /** Record one vote (a dispute-raise while `disputing`, a ballot while `voting`, a guess while `guessing`). */
  collectVote(ctx: RoundContext, vote: VoteInput): ScratchResult;

  /**
   * True when the guess phase is complete - every connected player has guessed - so the engine can
   * auto-close it, mirroring {@link allSubmitted}. Only consulted while `guessing`; optional, so a
   * game without a guess phase never implements it.
   */
  allDecided?(ctx: RoundContext): boolean;

  /**
   * Resolve the guess phase: tally the guesses, award points, and optionally produce the final
   * reveal. Called by the engine when the `guessing` phase closes (all-decided or the timer). Only
   * required by a game whose `reveal` returned a `decision`.
   */
  resolveDecision?(ctx: RoundContext): DecisionResult;

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

  /**
   * Live games only (spec 0044): step the continuously-running world once and return the snapshot to
   * broadcast. Implementing this marks the game "live" - the engine runs a per-session sim loop that
   * calls this on a fixed cadence and streams the returned `sim`, and does NOT drive the
   * reveal/dispute/leaderboard turn cycle (the game sits in one live phase, accepting moves via
   * {@link collectMove}, until `tick` reports `over`). Omitted by turn-based games, which are
   * unaffected.
   */
  tick?(ctx: RoundContext): LiveTickResult;

  /**
   * Live games only (spec 0044): called by the engine when a live session ends (endGame / host exit /
   * host restart) so the module can release its in-process world. A live module holds a per-session
   * world outside the engine's Redis-backed state (a Matter.js world for Teeter); without this hook
   * that world would leak once the session ends, and a restart would reuse the stale cached world
   * instead of rebuilding from empty scratch. Turn-based games hold no such state and omit it.
   */
  disposeLive?(ctx: RoundContext): void;
}
