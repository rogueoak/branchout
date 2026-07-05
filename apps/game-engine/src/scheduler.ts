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

/** Test scheduler: nothing fires until `flush()` (or `advance(ms)`) is called. */
export class ManualScheduler implements Scheduler {
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

  /** True while any task is still pending. */
  get pending(): number {
    return this.tasks.size;
  }
}
