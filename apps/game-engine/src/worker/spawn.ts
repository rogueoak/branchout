// The production worker spawn (spec 0045): turn a resolved worker-entry URL into a WorkerSpawn the
// WorkerManager calls per session. Kept tiny and dependency-injected (the URL + execArgv come from the
// caller) so the manager's own tests never touch real threads - they inject a fake spawn instead.

import { Worker } from 'node:worker_threads';
import type { WorkerHandle, WorkerSpawn } from './manager';

/**
 * Build a {@link WorkerSpawn} that starts the game worker at `workerUrl`. `execArgv` lets dev pass the
 * tsx loader (to run the `.ts` entry directly under `tsx watch`); production passes `[]` and runs the
 * bundled `.js`. The game id + seed travel in the manager's `init` message, not worker construction, so
 * they are unused here. A Node `Worker` already satisfies {@link WorkerHandle} (postMessage/on/terminate).
 */
export function createWorkerSpawn(workerUrl: URL, execArgv: string[] = []): WorkerSpawn {
  return (): WorkerHandle =>
    new Worker(workerUrl, {
      execArgv,
      // Surface the worker's own stdout/stderr on the engine's streams (crash stacks, native warnings).
      stdout: false,
      stderr: false,
    }) as unknown as WorkerHandle;
}
