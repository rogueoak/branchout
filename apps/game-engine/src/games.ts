// The single registered-games list (spec 0045). The main thread (index.ts) reads it for manifests
// (config validation at the /sessions boundary) and each session's worker (worker/game-worker.ts)
// reads it to BUILD the module. Keeping one list means adding a game is a one-place edit - a game
// added here is both accepted at handoff and buildable in the worker, so the two can never drift.

import type { GamePlugin } from '@branchout/game-sdk';
import { triviaPlugin } from '@branchout/game-trivia';
import { liarLiarPlugin } from '@branchout/game-liar-liar';
import { teeterTowerPlugin } from '@branchout/game-teeter-tower';

export const PLUGINS: readonly GamePlugin[] = [triviaPlugin, liarLiarPlugin, teeterTowerPlugin];
