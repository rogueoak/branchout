import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerCapError, WorkerManager, type WorkerHandle } from './manager';
import type { CallPayload, EngineToWorker, WorkerCapabilities, WorkerToEngine } from './protocol';

// Unit tests for the main-thread WorkerManager (spec 0045). A fake WorkerHandle stands in for a real
// worker_thread so the routing/timeout/cap/respawn LOGIC is exercised deterministically and fast; the
// real threading is proven by the e2e (all three games play through workers). The fake lets each test
// script how the "worker" answers init and each call: ready, error, or silence (a hang).

const CAPS: WorkerCapabilities = {
  live: false,
  allSubmitted: false,
  answeredCount: false,
  allDecided: false,
  resolveDecision: false,
  disposeLive: false,
};

/** How a fake worker should react to a message the engine posts to it. */
interface FakeBehavior {
  /** What to do on `init`: reply ready (default), reply init-error, or stay silent (hang). */
  onInit?: 'ready' | 'init-error' | 'silent';
  capabilities?: WorkerCapabilities;
  /** What to do on each `call`: echo an ok result (default), reply error, or stay silent (hang). */
  onCall?: 'result' | 'error' | 'silent';
}

/** A controllable stand-in for a Node worker_thread that records what it was told and how it replied. */
class FakeWorker implements WorkerHandle {
  readonly posted: EngineToWorker[] = [];
  terminated = 0;
  private messageHandlers: ((m: WorkerToEngine) => void)[] = [];

  constructor(private readonly behavior: FakeBehavior) {}

  postMessage(message: EngineToWorker): void {
    this.posted.push(message);
    if (message.type === 'init') this.reactToInit();
    else this.reactToCall(message.id);
  }

  on(event: 'message', handler: (m: WorkerToEngine) => void): void;
  on(event: 'error', handler: (e: Error) => void): void;
  on(event: 'exit', handler: (c: number) => void): void;
  on(event: string, handler: (arg: never) => void): void {
    if (event === 'message') this.messageHandlers.push(handler as (m: WorkerToEngine) => void);
    // error/exit are driven explicitly via emitError/emitExit in tests, so they are not stored here.
    if (event === 'error') this.errorHandler = handler as (e: Error) => void;
    if (event === 'exit') this.exitHandler = handler as (c: number) => void;
  }

  terminate(): number {
    this.terminated += 1;
    return 0;
  }

  private errorHandler: ((e: Error) => void) | null = null;
  private exitHandler: ((c: number) => void) | null = null;

  /** Simulate the worker thread crashing (an uncaught error). */
  emitError(error: Error): void {
    this.errorHandler?.(error);
  }

  /** Simulate the worker thread exiting. */
  emitExit(code: number): void {
    this.exitHandler?.(code);
  }

  private emit(message: WorkerToEngine): void {
    for (const handler of this.messageHandlers) handler(message);
  }

  private reactToInit(): void {
    const mode = this.behavior.onInit ?? 'ready';
    if (mode === 'ready')
      this.emit({ type: 'ready', capabilities: this.behavior.capabilities ?? CAPS });
    else if (mode === 'init-error') this.emit({ type: 'init-error', error: 'boom at build' });
    // 'silent' -> never reply; the manager's init timeout should fire.
  }

  private reactToCall(id: number): void {
    const mode = this.behavior.onCall ?? 'result';
    if (mode === 'result') this.emit({ type: 'result', id, ok: true, value: { echoed: id } });
    else if (mode === 'error') this.emit({ type: 'result', id, ok: false, error: 'call failed' });
    // 'silent' -> never reply; the manager's call timeout should fire.
  }
}

const payload: CallPayload = { ctx: {} as CallPayload['ctx'] };

/** Build a manager whose spawn hands out fakes from a queue, so a test controls each (re)spawn. */
function managerWith(fakes: FakeWorker[], opts?: { max?: number; callTimeoutMs?: number }) {
  const spawned: FakeWorker[] = [];
  let i = 0;
  const manager = new WorkerManager({
    spawn: () => {
      const fake = fakes[i++];
      if (!fake) throw new Error(`no fake worker queued for spawn #${i}`);
      spawned.push(fake);
      return fake;
    },
    max: opts?.max ?? 4,
    callTimeoutMs: opts?.callTimeoutMs ?? 1000,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
  });
  return { manager, spawned };
}

describe('WorkerManager', () => {
  it('spawns one worker per session, inits it, and routes a call to its reply', async () => {
    const { manager, spawned } = managerWith([new FakeWorker({})]);

    const result = await manager.call('roomA:trivia', 'trivia', 7, 'startRound', payload);

    expect(result).toEqual({ echoed: 1 });
    expect(spawned).toHaveLength(1);
    // The worker was told to build for the right game + seed before any call.
    const worker = spawned[0]!;
    expect(worker.posted[0]).toEqual({ type: 'init', game: 'trivia', seed: 7 });
    expect(worker.posted[1]).toMatchObject({ type: 'call', method: 'startRound' });
    expect(manager.size()).toBe(1);
  });

  it('reuses the same worker for repeated calls on one session (spawns once)', async () => {
    const { manager, spawned } = managerWith([new FakeWorker({})]);

    await manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload);
    await manager.call('roomA:trivia', 'trivia', 1, 'reveal', payload);
    await manager.call('roomA:trivia', 'trivia', 1, 'advance', payload);

    expect(spawned).toHaveLength(1);
    expect(manager.size()).toBe(1);
  });

  it('caches capabilities reported at init and serves them without a call', async () => {
    const caps = { ...CAPS, live: true, disposeLive: true };
    const { manager } = managerWith([new FakeWorker({ capabilities: caps })]);

    expect(await manager.capabilities('roomA:teeter', 'teeter-tower', 3)).toEqual(caps);
  });

  it('rejects a call when the worker fails to build (init-error), and terminates it', async () => {
    const fake = new FakeWorker({ onInit: 'init-error' });
    const { manager } = managerWith([fake]);

    await expect(manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload)).rejects.toThrow(
      /worker init failed: boom at build/,
    );
    expect(fake.terminated).toBe(1);
    expect(manager.size()).toBe(0); // dropped, so the next call respawns
  });

  it('surfaces a module-level call error without killing the worker', async () => {
    const fake = new FakeWorker({ onCall: 'error' });
    const { manager } = managerWith([fake]);

    await expect(manager.call('roomA:trivia', 'trivia', 1, 'collectMove', payload)).rejects.toThrow(
      /call failed/,
    );
    // A rejected move is a game-logic outcome, not a crash: the worker stays up for the next call.
    expect(fake.terminated).toBe(0);
    expect(manager.size()).toBe(1);
  });

  it('enforces the worker cap for new sessions but never for an existing one', async () => {
    const { manager } = managerWith([new FakeWorker({}), new FakeWorker({})], { max: 2 });

    await manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload);
    await manager.call('roomB:trivia', 'trivia', 1, 'startRound', payload);
    expect(manager.size()).toBe(2);

    // A third distinct session is over the cap.
    await expect(
      manager.call('roomC:trivia', 'trivia', 1, 'startRound', payload),
    ).rejects.toBeInstanceOf(WorkerCapError);

    // ...but the two already-running sessions keep serving calls fine.
    await expect(manager.call('roomA:trivia', 'trivia', 1, 'reveal', payload)).resolves.toEqual({
      echoed: 2,
    });
  });

  it('reopens a slot for a new session after one is disposed (the cap is a live count)', async () => {
    const { manager } = managerWith([new FakeWorker({}), new FakeWorker({}), new FakeWorker({})], {
      max: 2,
    });

    await manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload);
    await manager.call('roomB:trivia', 'trivia', 1, 'startRound', payload);
    await expect(
      manager.call('roomC:trivia', 'trivia', 1, 'startRound', payload),
    ).rejects.toBeInstanceOf(WorkerCapError);

    // Freeing a slot lets a new session spawn - the cap counts live workers, not a high-water mark.
    await manager.dispose('roomA:trivia');
    await expect(manager.call('roomC:trivia', 'trivia', 1, 'startRound', payload)).resolves.toEqual(
      {
        echoed: 1,
      },
    );
    expect(manager.size()).toBe(2);
  });

  it('a hung session does not block a healthy neighbor while its call is outstanding', async () => {
    const hung = new FakeWorker({ onCall: 'silent' }); // never replies - the call is left in flight
    const healthy = new FakeWorker({});
    const { manager } = managerWith([hung, healthy], { callTimeoutMs: 10_000 });

    const stalled = manager.call('roomA:teeter', 'teeter-tower', 1, 'tick', payload);
    const guard = stalled.catch(() => 'rejected'); // it eventually times out on dispose; absorb that

    // The neighbor's worker answers immediately even though A's request is stuck - the hang is
    // contained to A's thread and never occupies the main loop (the whole point of the spec).
    await expect(manager.call('roomB:trivia', 'trivia', 1, 'startRound', payload)).resolves.toEqual(
      {
        echoed: 1,
      },
    );

    await manager.dispose('roomA:teeter'); // clean up A's pending call + its timer
    await expect(guard).resolves.toBe('rejected');
  });

  it('contains a crash: rejects the in-flight call, drops the worker, respawns on the next call', async () => {
    const dead = new FakeWorker({ onCall: 'silent' }); // accepts the call but never replies...
    const fresh = new FakeWorker({}); // ...the respawn answers normally
    const { manager, spawned } = managerWith([dead, fresh]);

    const inFlight = manager.call('roomA:teeter', 'teeter-tower', 5, 'tick', payload);
    // Let the call actually reach the worker (call awaits `ready`, then posts), then crash the thread
    // while the request is outstanding.
    await Promise.resolve();
    expect(dead.posted).toContainEqual(expect.objectContaining({ type: 'call', method: 'tick' }));
    dead.emitError(new Error('segfault in physics'));
    await expect(inFlight).rejects.toThrow(/segfault in physics/);
    expect(manager.size()).toBe(0);

    // The next call respawns a fresh worker and rebuilds (same game + seed), transparently.
    const recovered = await manager.call('roomA:teeter', 'teeter-tower', 5, 'tick', payload);
    expect(recovered).toEqual({ echoed: 1 });
    expect(spawned).toHaveLength(2);
    expect(fresh.posted[0]).toEqual({ type: 'init', game: 'teeter-tower', seed: 5 });
  });

  it('one session crashing leaves other sessions untouched', async () => {
    const teeter = new FakeWorker({ onCall: 'silent' });
    const trivia = new FakeWorker({});
    const { manager } = managerWith([teeter, trivia]);

    const hung = manager.call('roomA:teeter', 'teeter-tower', 1, 'tick', payload);
    await manager.call('roomB:trivia', 'trivia', 1, 'startRound', payload); // healthy neighbor

    teeter.emitError(new Error('down'));
    await expect(hung).rejects.toThrow(/down/);

    // The neighbor's worker is still up and answering.
    expect(manager.size()).toBe(1);
    await expect(manager.call('roomB:trivia', 'trivia', 1, 'reveal', payload)).resolves.toEqual({
      echoed: 2,
    });
  });

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('kills a hung call at the timeout and respawns on the next call', async () => {
      const hang = new FakeWorker({ onCall: 'silent' });
      const fresh = new FakeWorker({});
      const { manager, spawned } = managerWith([hang, fresh], { callTimeoutMs: 500 });

      const inFlight = manager.call('roomA:teeter', 'teeter-tower', 9, 'tick', payload);
      const assertion = expect(inFlight).rejects.toThrow(/timed out after 500ms/);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      expect(hang.terminated).toBe(1);
      expect(manager.size()).toBe(0);

      const recovered = await manager.call('roomA:teeter', 'teeter-tower', 9, 'tick', payload);
      expect(recovered).toEqual({ echoed: 1 });
      expect(spawned).toHaveLength(2);
    });

    it('times out an init that never replies ready', async () => {
      const silentInit = new FakeWorker({ onInit: 'silent' });
      const { manager } = managerWith([silentInit], { callTimeoutMs: 300 });

      const call = manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload);
      const assertion = expect(call).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(300);
      await assertion;
      expect(silentInit.terminated).toBe(1);
    });
  });

  it('disposes a session, terminating its worker', async () => {
    const fake = new FakeWorker({});
    const { manager } = managerWith([fake]);

    await manager.call('roomA:trivia', 'trivia', 1, 'startRound', payload);
    await manager.dispose('roomA:trivia');

    expect(fake.terminated).toBe(1);
    expect(manager.size()).toBe(0);
    await manager.dispose('roomA:trivia'); // idempotent / safe on an unknown key
  });
});
