import { afterEach, describe, expect, it } from 'vitest';
import { WorkerManager } from './manager';
import { createWorkerSpawn } from './spawn';
import { WorkerRuntimeProvider } from './runtime';

// Real-thread integration for the worker runtime (spec 0045). Unlike manager.test.ts (which drives a
// fake worker to exercise the routing/timeout/cap LOGIC), this spawns the ACTUAL game-worker in a real
// Node worker_thread and builds REAL game modules in it - proving the bundle boots, the plugin registry
// resolves, capabilities report correctly, calls round-trip across the thread boundary, and a torn-down
// worker respawns + rebuilds transparently. It runs the TS entry via tsx (the dev spawn path), so it
// needs no prior build.
//
// SKIPPED IN CI: spawning many real worker_threads through the tsx loader inside the CI unit-test job
// segfaults the runner (a nested loader/thread interaction on the CI Node). CI's real-thread coverage
// comes from the e2e job instead, which drives the actual bundled worker end to end through the full
// browser -> engine -> worker loop for all three games. This suite runs locally for fast feedback.
const describeRealWorker = process.env.CI ? describe.skip : describe;

// Spawn the source worker through tsx, exactly as `pnpm dev` does; ['--import','tsx'] runs the .ts entry.
const workerUrl = new URL('./game-worker.ts', import.meta.url);
const spawn = createWorkerSpawn(workerUrl, ['--import', 'tsx']);

const managers: WorkerManager[] = [];
function makeManager(): WorkerManager {
  const manager = new WorkerManager({
    spawn,
    max: 8,
    // Loading a real game module (Trivia reads ~1600 questions; Teeter loads matter.js) plus thread
    // startup can take a beat on a cold CI box, so allow well past a snappy call.
    callTimeoutMs: 15_000,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
  });
  managers.push(manager);
  return manager;
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disposeAll();
});

const player = { player: 'p1', nickname: 'P1', connected: false, isHost: true };

describeRealWorker('game worker (real worker_thread)', () => {
  it('builds a live game (Teeter) in a worker and reports live capabilities', async () => {
    const manager = makeManager();
    const caps = await manager.capabilities('room1:teeter-tower', 'teeter-tower', 1);
    expect(caps.live).toBe(true); // Teeter implements tick - the engine runs a sim loop for it
  }, 20_000);

  it('builds a turn-based game (Trivia) and reports non-live capabilities distinct from Teeter', async () => {
    const manager = makeManager();
    const caps = await manager.capabilities('room1:trivia', 'trivia', 1);
    expect(caps.live).toBe(false);
    expect(caps.allSubmitted).toBe(true); // Trivia auto-closes a round once everyone answered
  }, 20_000);

  it('round-trips a real module call (configure) across the thread boundary', async () => {
    const provider = new WorkerRuntimeProvider(makeManager());
    const runtime = await provider.runtime('room1:teeter-tower', 'teeter-tower', 99);
    const cfg = await runtime.configure({}, [player]);
    // Teeter configures a fixed multi-round climb; the exact count is the game's, we just prove the
    // real module ran in the worker and returned its serialized result.
    expect(cfg.rounds).toBeGreaterThan(1);
    expect(cfg.scratch).toBeTypeOf('object');
  }, 20_000);

  it('rejects a bad config from inside the worker (the real module validates)', async () => {
    const provider = new WorkerRuntimeProvider(makeManager());
    const runtime = await provider.runtime('room1:trivia', 'trivia', 1);
    // Trivia requires known categories; an unknown one is refused by the module in the worker, which
    // surfaces as a rejected call - not a crash.
    await expect(
      runtime.configure({ rounds: 1, categories: ['Nonsense'] }, [player]),
    ).rejects.toThrow(/categor/i);
  }, 20_000);

  it('respawns and rebuilds the same procedural content after the worker is torn down', async () => {
    const provider = new WorkerRuntimeProvider(makeManager());
    const key = 'room1:teeter-tower';

    const first = await provider.runtime(key, 'teeter-tower', 5);
    const before = await first.configure({}, [player]);
    expect(before.rounds).toBeGreaterThan(1);

    // Kill the worker (as a crash/hang watchdog would). The next use must respawn a fresh thread and
    // rebuild the module from the same seed - the caller just asks again.
    await provider.dispose(key);

    const second = await provider.runtime(key, 'teeter-tower', 5);
    const after = await second.configure({}, [player]);
    // Same seed -> byte-identical build (Teeter derives its piece-stream seed from the rng), proving
    // the respawn replays the same procedural content, not just the same static round count.
    expect(after).toEqual(before);
  }, 30_000);

  it('a different seed yields different procedural content (the seed genuinely drives the build)', async () => {
    // Guards the test above from being vacuous: if the build ignored the seed, the equality would
    // pass trivially. Two workers with different seeds must produce different scratch.
    const provider = new WorkerRuntimeProvider(makeManager());
    const a = await (
      await provider.runtime('roomS1:teeter-tower', 'teeter-tower', 111)
    ).configure({}, [player]);
    const b = await (
      await provider.runtime('roomS2:teeter-tower', 'teeter-tower', 222)
    ).configure({}, [player]);
    expect(a.scratch).not.toEqual(b.scratch);
  }, 30_000);

  it('keeps sessions isolated: disposing one worker leaves another serving', async () => {
    const manager = makeManager();
    const provider = new WorkerRuntimeProvider(manager);

    const teeter = await provider.runtime('roomA:teeter-tower', 'teeter-tower', 1);
    const trivia = await provider.runtime('roomB:trivia', 'trivia', 1);
    await teeter.configure({}, [player]);
    await trivia.configure({ rounds: 1, category: 'Science' }, [player]);
    expect(manager.size()).toBe(2);

    await provider.dispose('roomA:teeter-tower');
    expect(manager.size()).toBe(1);

    // The untouched neighbor still answers on its own thread.
    const stillUp = await provider.runtime('roomB:trivia', 'trivia', 1);
    const cfg = await stillUp.configure({ rounds: 1, category: 'Science' }, [player]);
    expect(cfg.rounds).toBe(1);
  }, 30_000);
});
