// The game worker (spec 0045). One instance runs per game session in a Node worker_thread. On `init`
// it builds the session's GameModule via `plugin.create(services)`, then answers `call` requests by
// invoking the module and posting the result. It owns the module's in-process state (scratch + the live
// Matter world for a physics game) and runs no I/O of its own - the engine handles all sockets/Redis/
// pub/sub and simply forwards calls here, so the module's CPU (including the physics tick) stays off the
// main event loop. A hung or crashed worker is terminated + respawned by the main-thread manager; the
// module then rebuilds lazily from the ctx scratch on the next call.

import { parentPort } from 'node:worker_threads';
import { createFsAssetLoaderFactory, type GameModule, type GamePlugin } from '@branchout/game-sdk';
import { triviaPlugin } from '@branchout/game-trivia';
import { liarLiarPlugin } from '@branchout/game-liar-liar';
import { teeterTowerPlugin } from '@branchout/game-teeter-tower';
import type {
  CallMessage,
  EngineToWorker,
  InitMessage,
  WorkerCapabilities,
  WorkerToEngine,
} from './protocol';

/** The plugin registry the worker builds its one module from - the same list the engine boots with. */
const PLUGINS: readonly GamePlugin[] = [triviaPlugin, liarLiarPlugin, teeterTowerPlugin];

/** A seeded, deterministic [0,1) rng (Mulberry32), so a build is reproducible from the init seed. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Post a message to the engine (the parent thread). Throws if somehow run outside a worker. */
function post(message: WorkerToEngine): void {
  if (!parentPort) throw new Error('game-worker must run in a worker_thread');
  parentPort.postMessage(message);
}

/** The optional-facet capabilities the engine needs to know (which methods the built module implements). */
function capabilitiesOf(module: GameModule): WorkerCapabilities {
  return {
    live: typeof module.tick === 'function',
    allSubmitted: typeof module.allSubmitted === 'function',
    allDecided: typeof module.allDecided === 'function',
    resolveDecision: typeof module.resolveDecision === 'function',
    disposeLive: typeof module.disposeLive === 'function',
  };
}

/** The built module for this worker's one game; null until `init` completes. */
let current: GameModule | null = null;

async function handleInit(message: InitMessage): Promise<void> {
  const plugin = PLUGINS.find((p) => p.manifest.id === message.game);
  if (!plugin) {
    post({ type: 'init-error', error: `no plugin registered with id "${message.game}"` });
    return;
  }
  try {
    const module = await plugin.create({
      rng: seededRng(message.seed),
      // Forward game logs to the engine's console so a worker is not a silent black box.
      logger: {
        error: (...args: unknown[]) => post({ type: 'log', level: 'error', args }),
        warn: (...args: unknown[]) => post({ type: 'log', level: 'warn', args }),
        info: (...args: unknown[]) => post({ type: 'log', level: 'info', args }),
      },
      assets: createFsAssetLoaderFactory(),
    });
    if (module.id !== plugin.manifest.id) {
      post({
        type: 'init-error',
        error: `plugin "${plugin.manifest.id}" built a module with mismatched id "${module.id}"`,
      });
      return;
    }
    current = module;
    post({ type: 'ready', capabilities: capabilitiesOf(module) });
  } catch (error) {
    post({ type: 'init-error', error: error instanceof Error ? error.message : String(error) });
  }
}

/** Invoke a GameModule method from a call payload. Optional methods absent on the module return undefined. */
function invoke(module: GameModule, message: CallMessage): unknown {
  const { method, payload } = message;
  const { ctx } = payload;
  switch (method) {
    case 'configure':
      return module.configure(payload.config, payload.players ?? []);
    case 'startRound':
      return module.startRound(ctx);
    case 'collectMove':
      return module.collectMove(ctx, payload.player ?? '', payload.move ?? '');
    case 'allSubmitted':
      return module.allSubmitted?.(ctx);
    case 'reveal':
      return module.reveal(ctx);
    case 'collectVote':
      return module.collectVote(ctx, payload.vote ?? { player: '', target: '', agree: false });
    case 'allDecided':
      return module.allDecided?.(ctx);
    case 'resolveDecision':
      return module.resolveDecision?.(ctx);
    case 'disputeWindow':
      return module.disputeWindow(ctx);
    case 'disputeVote':
      return module.disputeVote(ctx);
    case 'leaderboard':
      return module.leaderboard(ctx);
    case 'advance':
      return module.advance(ctx);
    case 'endGame':
      return module.endGame(ctx);
    case 'tick':
      return module.tick?.(ctx);
    case 'disposeLive':
      module.disposeLive?.(ctx);
      return undefined;
    default:
      throw new Error(`unknown worker method "${String(method)}"`);
  }
}

function handleCall(message: CallMessage): void {
  if (!current) {
    post({ type: 'result', id: message.id, ok: false, error: 'worker not initialized' });
    return;
  }
  try {
    const value = invoke(current, message);
    post({ type: 'result', id: message.id, ok: true, value });
  } catch (error) {
    post({
      type: 'result',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (parentPort) {
  parentPort.on('message', (message: EngineToWorker) => {
    if (message.type === 'init') {
      void handleInit(message);
    } else if (message.type === 'call') {
      handleCall(message);
    }
  });
}
