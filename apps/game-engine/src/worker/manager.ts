// The session -> worker manager (spec 0045), on the main thread. It spawns one worker per game session
// (keyed by `room:game`), routes each `module.X` call to that worker and correlates the reply, and
// CONTAINS failure: a worker that crashes (error/exit) or hangs (a call/init timeout) is terminated and
// dropped, so the next call respawns it and the module rebuilds lazily from the ctx scratch (spec 0044's
// seeded, snapshot-rebuildable world). A configurable cap bounds concurrent workers. Other sessions'
// workers are independent, so one game's failure never touches another room.
//
// Worker spawning is injected (a `WorkerHandle` factory) so the routing/timeout/cap/respawn logic is
// unit-testable with fake modules; production injects a real Node worker_thread. Real threading end to
// end is covered by the e2e (all three games play through workers).

import type {
  CallPayload,
  EngineToWorker,
  WorkerCapabilities,
  WorkerMethod,
  WorkerToEngine,
} from './protocol';

/** The subset of a Node `Worker` the manager drives; a fake implements this in tests. */
export interface WorkerHandle {
  postMessage(message: EngineToWorker): void;
  on(event: 'message', handler: (message: WorkerToEngine) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'exit', handler: (code: number) => void): void;
  /** Force-kill the thread (worker_threads can terminate a thread the event loop can't escape). */
  terminate(): Promise<number> | number;
}

/** Builds a fresh worker for a game. Called on first use and on every respawn after a failure. */
export type WorkerSpawn = (game: string, seed: number) => WorkerHandle;

export interface WorkerManagerOptions {
  spawn: WorkerSpawn;
  /** Max concurrent workers; a new session past this is rejected (existing ones keep running). */
  max: number;
  /** Per-call (and init) timeout in ms; on breach the worker is killed as hung. */
  callTimeoutMs: number;
  logger?: Pick<Console, 'error' | 'warn' | 'info'>;
}

/** Thrown when a new session would exceed the worker cap. The engine surfaces this as a start error. */
export class WorkerCapError extends Error {
  constructor(max: number) {
    super(`worker cap reached (${max})`);
    this.name = 'WorkerCapError';
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  key: string;
  game: string;
  seed: number;
  worker: WorkerHandle;
  /** Resolves with the module's capabilities once the worker replies `ready`; rejects on init failure. */
  ready: Promise<WorkerCapabilities>;
  readyResolve: (caps: WorkerCapabilities) => void;
  readyReject: (error: Error) => void;
  settledReady: boolean;
  /** Fires if the worker never replies `ready` - a build that hangs is killed like any other hang. */
  readyTimer: ReturnType<typeof setTimeout>;
  pending: Map<number, PendingCall>;
  nextId: number;
  /** False once the worker has failed / been terminated - a new call respawns a fresh session. */
  alive: boolean;
}

export class WorkerManager {
  private readonly sessions = new Map<string, Session>();
  private readonly spawn: WorkerSpawn;
  private readonly max: number;
  private readonly callTimeoutMs: number;
  private readonly logger: Pick<Console, 'error' | 'warn' | 'info'>;

  constructor(options: WorkerManagerOptions) {
    this.spawn = options.spawn;
    this.max = options.max;
    this.callTimeoutMs = options.callTimeoutMs;
    this.logger = options.logger ?? console;
  }

  /** Number of live workers (for the cap + observability/tests). */
  size(): number {
    return this.sessions.size;
  }

  /** The built module's capabilities for a session (spawning + initializing it if needed). */
  async capabilities(key: string, game: string, seed: number): Promise<WorkerCapabilities> {
    return this.ensure(key, game, seed).ready;
  }

  /**
   * Invoke a GameModule method in the session's worker, awaiting the reply. Spawns/initializes the
   * worker on first use. Rejects if the worker crashes or the call times out (the worker is killed and
   * the session dropped, so the next call respawns + the module rebuilds from ctx scratch).
   */
  async call(
    key: string,
    game: string,
    seed: number,
    method: WorkerMethod,
    payload: CallPayload,
  ): Promise<unknown> {
    const session = this.ensure(key, game, seed);
    await session.ready; // waits for the module to build; throws (respawns next call) on init failure
    return this.send(session, method, payload);
  }

  /** Tear down a session's worker (on endGame / host exit). Safe if none exists. */
  async dispose(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.fail(session, new Error('worker disposed'));
  }

  /** Tear down every worker (on engine shutdown). */
  async disposeAll(): Promise<void> {
    for (const key of [...this.sessions.keys()]) await this.dispose(key);
  }

  // --- internals ---

  /** Get the session for a key, spawning a fresh worker if missing (enforcing the cap on a NEW session). */
  private ensure(key: string, game: string, seed: number): Session {
    const existing = this.sessions.get(key);
    if (existing && existing.alive) return existing;
    if (!existing && this.sessions.size >= this.max) throw new WorkerCapError(this.max);
    return this.create(key, game, seed);
  }

  private create(key: string, game: string, seed: number): Session {
    let readyResolve!: (caps: WorkerCapabilities) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<WorkerCapabilities>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    // Never let a rejected `ready` become an unhandled rejection if no call is awaiting it yet.
    ready.catch(() => undefined);

    const worker = this.spawn(game, seed);
    const session: Session = {
      key,
      game,
      seed,
      worker,
      ready,
      readyResolve,
      readyReject,
      settledReady: false,
      readyTimer: setTimeout(() => {
        this.fail(session, new Error(`worker init timed out after ${this.callTimeoutMs}ms`));
      }, this.callTimeoutMs),
      pending: new Map(),
      nextId: 1,
      alive: true,
    };
    this.sessions.set(key, session);

    worker.on('message', (message) => this.onMessage(session, message));
    worker.on('error', (error) => this.fail(session, error));
    worker.on('exit', (code) => {
      if (session.alive) this.fail(session, new Error(`worker exited (code ${code})`));
    });

    worker.postMessage({ type: 'init', game, seed });
    return session;
  }

  private onMessage(session: Session, message: WorkerToEngine): void {
    switch (message.type) {
      case 'ready':
        session.settledReady = true;
        clearTimeout(session.readyTimer);
        session.readyResolve(message.capabilities);
        return;
      case 'init-error':
        this.fail(session, new Error(`worker init failed: ${message.error}`));
        return;
      case 'result': {
        const pending = session.pending.get(message.id);
        if (!pending) return; // already timed out / failed
        clearTimeout(pending.timer);
        session.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error ?? 'worker call failed'));
        return;
      }
      case 'log':
        this.logger[message.level](`[game-worker ${session.game}]`, ...message.args);
        return;
    }
  }

  private send(session: Session, method: WorkerMethod, payload: CallPayload): Promise<unknown> {
    // The session can die between `await ready` and here (a crash in that gap); don't post into the void.
    if (!session.alive)
      return Promise.reject(new Error(`worker for "${session.key}" is not available`));
    return new Promise<unknown>((resolve, reject) => {
      const id = session.nextId++;
      const timer = setTimeout(() => {
        // A hang. Reject this call directly (so it is never stranded even if the session is already
        // failing), then force-kill the worker and drop the session so the next call respawns + rebuilds.
        const pending = session.pending.get(id);
        if (pending) {
          session.pending.delete(id);
          pending.reject(
            new Error(`worker call "${method}" timed out after ${this.callTimeoutMs}ms`),
          );
        }
        this.fail(
          session,
          new Error(`worker call "${method}" timed out after ${this.callTimeoutMs}ms`),
        );
      }, this.callTimeoutMs);
      session.pending.set(id, { resolve, reject, timer });
      session.worker.postMessage({ type: 'call', id, method, payload });
    });
  }

  /** Kill a session: reject its in-flight calls + pending ready, terminate the worker, drop it. */
  private fail(session: Session, error: Error): void {
    if (!session.alive) return;
    session.alive = false;
    clearTimeout(session.readyTimer);
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    for (const [, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
    if (!session.settledReady) {
      session.settledReady = true;
      session.readyReject(error);
    }
    try {
      void Promise.resolve(session.worker.terminate()).catch(() => undefined);
    } catch {
      // terminate can throw synchronously on an already-dead worker; ignore.
    }
  }
}
