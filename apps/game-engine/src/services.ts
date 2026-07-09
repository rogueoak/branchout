// The composition root for game dependency injection. `createGameServices` builds the production
// `GameServices` the harness hands to every plugin's `create()`: real randomness, the console
// logger, and a filesystem asset loader that roots each game at its own package. Tests build their
// own services via @branchout/game-sdk/testing.

import { createFsAssetLoaderFactory, type GameServices } from '@branchout/game-sdk';

export function createGameServices(overrides: Partial<GameServices> = {}): GameServices {
  return {
    rng: Math.random,
    logger: console,
    assets: createFsAssetLoaderFactory(),
    ...overrides,
  };
}
