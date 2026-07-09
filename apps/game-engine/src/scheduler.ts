// A tiny scheduling seam so the engine's timers (the dispute window) are deterministic in tests.
// Production uses real timers; tests inject a manual scheduler and advance time explicitly, so no
// test waits on wall-clock and no timer flakes.

export interface Scheduler {
  /** Run `fn` after `delayMs`. Returns a cancel function. */
  schedule(delayMs: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  schedule(delayMs, fn) {
    const handle = setTimeout(fn, delayMs);
    // Do not keep the process alive just for a pending game timer.
    if (typeof handle === 'object' && 'unref' in handle) {
      handle.unref();
    }
    return () => clearTimeout(handle);
  },
};

// The test scheduler (ManualScheduler) lives in @branchout/game-sdk/testing; it is structurally
// compatible with the Scheduler seam above, so tests inject it wherever a Scheduler is expected.
