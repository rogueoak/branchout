// The runtime seam (spec 0045). The engine used to hold a `GameModule` and call it synchronously; now
// each session's module runs in a worker, so the engine talks to a `SessionRuntime` - the same method
// surface, but async, and with the optional facets (`live`, `allSubmitted`, ...) reported as flags
// rather than probed via `typeof module.tick`. A `GameRuntimeProvider` hands the engine a runtime for a
// session (spawning/initializing the worker on first use) and tears it down on end.
//
// Two providers implement it: `WorkerRuntimeProvider` (production - routes every call to the session's
// worker_thread via the WorkerManager) and `InProcessRuntimeProvider` (tests - runs plain in-memory
// modules directly, so the engine's unit tests stay fast and deterministic without real threads). The
// engine depends only on the interface, so it neither spawns threads nor knows which provider it has.

import type { Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DecisionResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  LiveTickResult,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
  VoteInput,
} from '@branchout/game-sdk';
import type { CallPayload, WorkerMethod } from './protocol';
import { WorkerManager } from './manager';

/**
 * The engine's async view of one session's game module. Method names/semantics mirror {@link GameModule};
 * the `*` facet flags stand in for the old `typeof module.x === 'function'` probes. The optional methods
 * (`allSubmitted`, `allDecided`, `resolveDecision`, `tick`, `disposeLive`) resolve to a safe no-op value
 * when the module does not implement them, so the engine can await unconditionally and branch on the flag.
 */
export interface SessionRuntime {
  /** Implements `tick` - a continuous live game the engine runs a sim loop for (spec 0044). */
  readonly live: boolean;
  readonly hasAllSubmitted: boolean;
  readonly hasAllDecided: boolean;
  readonly hasResolveDecision: boolean;

  configure(config: unknown, players: readonly SessionPlayer[]): Promise<ConfigureResult>;
  startRound(ctx: RoundContext): Promise<StartRoundResult>;
  collectMove(ctx: RoundContext, player: string, move: string): Promise<ScratchResult>;
  /** False when the module has no `allSubmitted` (a game with no all-answered early close). */
  allSubmitted(ctx: RoundContext): Promise<boolean>;
  reveal(ctx: RoundContext): Promise<RevealResult>;
  collectVote(ctx: RoundContext, vote: VoteInput): Promise<ScratchResult>;
  /** False when the module has no `allDecided`. */
  allDecided(ctx: RoundContext): Promise<boolean>;
  /** Throws if the module has no `resolveDecision` (the engine guards on {@link hasResolveDecision}). */
  resolveDecision(ctx: RoundContext): Promise<DecisionResult>;
  disputeWindow(ctx: RoundContext): Promise<DisputeWindowResult>;
  disputeVote(ctx: RoundContext): Promise<DisputeVoteResult>;
  leaderboard(ctx: RoundContext): Promise<Standing[]>;
  advance(ctx: RoundContext): Promise<AdvanceResult>;
  endGame(ctx: RoundContext): Promise<Standing[]>;
  /** Steps the live world one tick; throws if the module is not live (guard on {@link live}). */
  tick(ctx: RoundContext): Promise<LiveTickResult>;
  /** Releases the module's live world; a no-op when the module has no `disposeLive`. */
  disposeLive(ctx: RoundContext): Promise<void>;
}

/** Hands the engine a runtime for a session and tears it down. One provider backs the whole engine. */
export interface GameRuntimeProvider {
  /**
   * The runtime for a session, keyed by `room:game`. Builds/initializes the worker (or in-process
   * module) on first use; the `seed` makes a rebuild after a worker respawn deterministic (spec 0044).
   */
  runtime(key: string, game: string, seed: number): Promise<SessionRuntime>;
  /** Tear down a session's worker (on endGame/exit/restart). Safe if none exists. */
  dispose(key: string): Promise<void>;
  /** Tear down every worker (on engine shutdown). */
  disposeAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Production: route every call to the session's worker_thread.
// ---------------------------------------------------------------------------

/** A {@link SessionRuntime} whose every method is a request to the session's worker via the manager. */
class WorkerSessionRuntime implements SessionRuntime {
  constructor(
    private readonly manager: WorkerManager,
    private readonly key: string,
    private readonly game: string,
    private readonly seed: number,
    readonly live: boolean,
    readonly hasAllSubmitted: boolean,
    readonly hasAllDecided: boolean,
    readonly hasResolveDecision: boolean,
  ) {}

  private call<T>(method: WorkerMethod, payload: CallPayload): Promise<T> {
    return this.manager.call(this.key, this.game, this.seed, method, payload) as Promise<T>;
  }

  configure(config: unknown, players: readonly SessionPlayer[]): Promise<ConfigureResult> {
    // configure runs before any round exists, so there is no real ctx yet; the worker ignores it.
    return this.call('configure', { ctx: EMPTY_CTX, config, players });
  }
  startRound(ctx: RoundContext): Promise<StartRoundResult> {
    return this.call('startRound', { ctx });
  }
  collectMove(ctx: RoundContext, player: string, move: string): Promise<ScratchResult> {
    return this.call('collectMove', { ctx, player, move });
  }
  async allSubmitted(ctx: RoundContext): Promise<boolean> {
    if (!this.hasAllSubmitted) return false;
    return (await this.call<boolean | undefined>('allSubmitted', { ctx })) ?? false;
  }
  reveal(ctx: RoundContext): Promise<RevealResult> {
    return this.call('reveal', { ctx });
  }
  collectVote(ctx: RoundContext, vote: VoteInput): Promise<ScratchResult> {
    return this.call('collectVote', { ctx, vote });
  }
  async allDecided(ctx: RoundContext): Promise<boolean> {
    if (!this.hasAllDecided) return false;
    return (await this.call<boolean | undefined>('allDecided', { ctx })) ?? false;
  }
  resolveDecision(ctx: RoundContext): Promise<DecisionResult> {
    return this.call('resolveDecision', { ctx });
  }
  disputeWindow(ctx: RoundContext): Promise<DisputeWindowResult> {
    return this.call('disputeWindow', { ctx });
  }
  disputeVote(ctx: RoundContext): Promise<DisputeVoteResult> {
    return this.call('disputeVote', { ctx });
  }
  leaderboard(ctx: RoundContext): Promise<Standing[]> {
    return this.call('leaderboard', { ctx });
  }
  advance(ctx: RoundContext): Promise<AdvanceResult> {
    return this.call('advance', { ctx });
  }
  endGame(ctx: RoundContext): Promise<Standing[]> {
    return this.call('endGame', { ctx });
  }
  tick(ctx: RoundContext): Promise<LiveTickResult> {
    return this.call('tick', { ctx });
  }
  async disposeLive(ctx: RoundContext): Promise<void> {
    await this.call('disposeLive', { ctx });
  }
}

/** The ctx placeholder for `configure`, which is called before a round context exists. */
const EMPTY_CTX = {} as RoundContext;

/** Production provider: one worker_thread per session, via the {@link WorkerManager}. */
export class WorkerRuntimeProvider implements GameRuntimeProvider {
  constructor(private readonly manager: WorkerManager) {}

  async runtime(key: string, game: string, seed: number): Promise<SessionRuntime> {
    const caps = await this.manager.capabilities(key, game, seed);
    return new WorkerSessionRuntime(
      this.manager,
      key,
      game,
      seed,
      caps.live,
      caps.allSubmitted,
      caps.allDecided,
      caps.resolveDecision,
    );
  }
  dispose(key: string): Promise<void> {
    return this.manager.dispose(key);
  }
  disposeAll(): Promise<void> {
    return this.manager.disposeAll();
  }
}

// ---------------------------------------------------------------------------
// Tests: run plain modules in-process (no threads), so engine tests stay fast + deterministic.
// ---------------------------------------------------------------------------

/** A {@link SessionRuntime} that calls a real {@link GameModule} directly, wrapping results in promises. */
class InProcessSessionRuntime implements SessionRuntime {
  readonly live: boolean;
  readonly hasAllSubmitted: boolean;
  readonly hasAllDecided: boolean;
  readonly hasResolveDecision: boolean;

  constructor(private readonly module: GameModule) {
    this.live = typeof module.tick === 'function';
    this.hasAllSubmitted = typeof module.allSubmitted === 'function';
    this.hasAllDecided = typeof module.allDecided === 'function';
    this.hasResolveDecision = typeof module.resolveDecision === 'function';
  }

  async configure(config: unknown, players: readonly SessionPlayer[]): Promise<ConfigureResult> {
    return this.module.configure(config, players);
  }
  async startRound(ctx: RoundContext): Promise<StartRoundResult> {
    return this.module.startRound(ctx);
  }
  async collectMove(ctx: RoundContext, player: string, move: string): Promise<ScratchResult> {
    return this.module.collectMove(ctx, player, move);
  }
  async allSubmitted(ctx: RoundContext): Promise<boolean> {
    return this.module.allSubmitted?.(ctx) ?? false;
  }
  async reveal(ctx: RoundContext): Promise<RevealResult> {
    return this.module.reveal(ctx);
  }
  async collectVote(ctx: RoundContext, vote: VoteInput): Promise<ScratchResult> {
    return this.module.collectVote(ctx, vote);
  }
  async allDecided(ctx: RoundContext): Promise<boolean> {
    return this.module.allDecided?.(ctx) ?? false;
  }
  async resolveDecision(ctx: RoundContext): Promise<DecisionResult> {
    if (!this.module.resolveDecision) throw new Error('module has no resolveDecision');
    return this.module.resolveDecision(ctx);
  }
  async disputeWindow(ctx: RoundContext): Promise<DisputeWindowResult> {
    return this.module.disputeWindow(ctx);
  }
  async disputeVote(ctx: RoundContext): Promise<DisputeVoteResult> {
    return this.module.disputeVote(ctx);
  }
  async leaderboard(ctx: RoundContext): Promise<Standing[]> {
    return this.module.leaderboard(ctx);
  }
  async advance(ctx: RoundContext): Promise<AdvanceResult> {
    return this.module.advance(ctx);
  }
  async endGame(ctx: RoundContext): Promise<Standing[]> {
    return this.module.endGame(ctx);
  }
  async tick(ctx: RoundContext): Promise<LiveTickResult> {
    if (!this.module.tick) throw new Error('module has no tick');
    return this.module.tick(ctx);
  }
  async disposeLive(ctx: RoundContext): Promise<void> {
    this.module.disposeLive?.(ctx);
  }
}

/**
 * Test/in-process provider: resolves modules from a map by game id and runs them on the main thread.
 * No worker isolation - it exists so the engine's unit tests exercise the async runtime seam without
 * spawning real threads. Production uses {@link WorkerRuntimeProvider}.
 */
export class InProcessRuntimeProvider implements GameRuntimeProvider {
  private readonly modules: Map<string, GameModule>;

  constructor(modules: Iterable<GameModule>) {
    this.modules = new Map([...modules].map((m) => [m.id, m]));
  }

  async runtime(key: string, game: string): Promise<SessionRuntime> {
    const module = this.modules.get(game);
    if (!module) throw new Error(`no game registered with id "${game}"`);
    return new InProcessSessionRuntime(module);
  }
  async dispose(): Promise<void> {}
  async disposeAll(): Promise<void> {}
}
