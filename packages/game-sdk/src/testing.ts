// Test-only helpers a game (or the harness) uses to unit-test lifecycle behavior deterministically:
// a manual scheduler (advance timers by hand), a seeded rng, in-memory `GameServices`, and the stub
// game. This is the `@branchout/game-sdk/testing` entry - it must never be imported by production
// code, so a game's shipped bundle stays free of fixtures.

import { createMemoryAssetLoaderFactory } from './assets';
import type { GameServices } from './plugin';

export { createMemoryAssetLoaderFactory } from './assets';
export { stubGame, stubPlugin, STUB_GAME_ID, type StubConfig } from './stub-game';
export { deciderGame, deciderPlugin, DECIDER_GAME_ID, type DeciderConfig } from './decider-game';

/** The structural shape the engine's scheduler seam expects; kept local so the SDK owns no engine dep. */
interface ManualSchedulerLike {
  schedule(delayMs: number, fn: () => void): () => void;
}

/**
 * A deterministic scheduler for tests: nothing fires until `flush()` is called, so no test waits on
 * wall-clock and no timer flakes. Structurally compatible with the engine's `Scheduler`.
 */
export class ManualScheduler implements ManualSchedulerLike {
  private seq = 0;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();
  private now = 0;

  schedule(delayMs: number, fn: () => void): () => void {
    const id = this.seq++;
    this.tasks.set(id, { at: this.now + delayMs, fn });
    return () => this.tasks.delete(id);
  }

  /** Fire every pending task, in scheduled order. */
  flush(): void {
    const pending = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at);
    this.tasks.clear();
    for (const [, task] of pending) {
      task.fn();
    }
  }

  /**
   * Advance virtual time by `ms` and fire only the tasks now due (`at <= now`), in scheduled order,
   * leaving later tasks pending. Lets a test target one timer (e.g. a 2s grace close) without also
   * firing a longer one (a 30s window), so it can prove which timer closed a round.
   */
  advance(ms: number): void {
    this.now += ms;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id] of due) this.tasks.delete(id);
    for (const [, task] of due) task.fn();
  }

  /** True while any task is still pending. */
  get pending(): number {
    return this.tasks.size;
  }
}

/** A small, fast, seedable PRNG (mulberry32). Seed it to make a whole game deterministic in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a `GameServices` for tests: a seeded rng, a silent logger, and an in-memory asset loader
 * over `files`. Any field can be overridden.
 */
export function createTestServices(
  overrides: Partial<GameServices> & { files?: Record<string, unknown> } = {},
): GameServices {
  const { files, ...rest } = overrides;
  return {
    rng: mulberry32(1),
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    assets: createMemoryAssetLoaderFactory(files ?? {}),
    ...rest,
  };
}
