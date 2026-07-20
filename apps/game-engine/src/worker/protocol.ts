// The engine <-> game-worker message protocol (spec 0045). Each running game session executes its
// GameModule in a dedicated Node worker_thread; the main-thread engine keeps all I/O (sockets, Redis,
// pub/sub) and orchestration, and forwards every `module.X(ctx, ...)` call to the session's worker as a
// request, awaiting the reply. Keeping the module compute (including the physics tick) off the main
// event loop means one heavy or hung game can no longer stall other rooms.
//
// All payloads are JSON-serializable: the GameModule contract's inputs (a RoundContext + primitives)
// and outputs (scratch + opaque prompt/reveal/sim payloads) already persist to Redis today, so nothing
// new needs to cross the thread boundary.

import type { RoundContext, SessionPlayer } from '../lifecycle';

/** The GameModule methods the engine can invoke in the worker (the id/capability props are not calls). */
export type WorkerMethod =
  | 'configure'
  | 'startRound'
  | 'collectMove'
  | 'allSubmitted'
  | 'answeredCount'
  | 'reveal'
  | 'collectVote'
  | 'allDecided'
  | 'resolveDecision'
  | 'disputeWindow'
  | 'disputeVote'
  | 'leaderboard'
  | 'advance'
  | 'endGame'
  | 'tick'
  | 'disposeLive';

/** Which optional GameModule facets the built module implements, reported once the worker is ready. */
export interface WorkerCapabilities {
  /** Implements `tick` - a continuous "live" game the engine runs a sim loop for (spec 0044). */
  live: boolean;
  allSubmitted: boolean;
  answeredCount: boolean;
  allDecided: boolean;
  resolveDecision: boolean;
  disposeLive: boolean;
}

// ---------------------------------------------------------------------------
// Engine -> worker
// ---------------------------------------------------------------------------

/** Build the module for one game via `plugin.create(services)`, then reply `ready` (or `init-error`). */
export interface InitMessage {
  type: 'init';
  /** The game id this worker is dedicated to (resolves the plugin). */
  game: string;
  /** The base seed for the module's rng, so a respawned worker rebuilds the same procedural content
   * (piece stream / question pick). The world is rebuilt from the ctx scratch - a best-effort resume. */
  seed: number;
}

/** Invoke a GameModule method; correlated by `id`. `payload` carries the RoundContext + method params. */
export interface CallMessage {
  type: 'call';
  id: number;
  method: WorkerMethod;
  payload: CallPayload;
}

export type EngineToWorker = InitMessage | CallMessage;

/** The per-method call payload. All fields are serializable; the worker rebuilds/uses them directly. */
export interface CallPayload {
  ctx: RoundContext;
  /** `configure` takes (config, players) rather than a ctx; carried here for that one method. */
  config?: unknown;
  players?: readonly SessionPlayer[];
  /** `collectMove` params. */
  player?: string;
  move?: string;
  /** `collectVote` params. */
  vote?: { player: string; target: string; agree: boolean };
}

// ---------------------------------------------------------------------------
// Worker -> engine
// ---------------------------------------------------------------------------

/** Sent once the module is built and ready to serve calls. */
export interface ReadyMessage {
  type: 'ready';
  capabilities: WorkerCapabilities;
}

/** Sent if building the module failed (bad plugin / configure that throws at build). Fatal for the worker. */
export interface InitErrorMessage {
  type: 'init-error';
  error: string;
}

/** A call's reply, correlated by `id`. `ok:true` carries the method's return `value`; else an `error`. */
export interface ResultMessage {
  type: 'result';
  id: number;
  ok: boolean;
  /** The method's return value when `ok` (already serializable). */
  value?: unknown;
  /** The error message when not `ok` (e.g. a `configure` that threw, or an unknown method). */
  error?: string;
}

/** A forwarded log line from game code, so a worker's logger surfaces on the engine's console. */
export interface LogMessage {
  type: 'log';
  level: 'error' | 'warn' | 'info';
  args: unknown[];
}

export type WorkerToEngine = ReadyMessage | InitErrorMessage | ResultMessage | LogMessage;
