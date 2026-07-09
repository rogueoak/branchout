// Loads the REAL shipped clue bank from disk (spec 0022) and runs the strict seed gate. This is the
// path-resolution guard: it proves the fs asset loader, rooted at this package via import.meta.url,
// resolves the package's own data/liar-liar files - the same resolution the engine relies on at boot.

import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  CATEGORIES,
  MIN_CLUES_PER_CATEGORY,
  loadClueBank,
  validateSeedBank,
  type LiarLiarClue,
} from './index';

async function realBank(): Promise<LiarLiarClue[]> {
  const assets = createFsAssetLoaderFactory().forModule(import.meta.url);
  return loadClueBank(assets);
}

describe('liar-liar seed clue bank (real data)', () => {
  it('loads from the package data dir and passes the strict seed gate', async () => {
    const bank = await realBank();
    expect(() => validateSeedBank(bank)).not.toThrow();
  });

  it('covers every category with at least the minimum number of clues', async () => {
    const bank = await realBank();
    for (const category of CATEGORIES) {
      const count = bank.filter((c) => c.category === category).length;
      expect(count).toBeGreaterThanOrEqual(MIN_CLUES_PER_CATEGORY);
    }
    expect(bank.length).toBeGreaterThanOrEqual(CATEGORIES.length * MIN_CLUES_PER_CATEGORY);
  });

  it('carries real, sourced clues (spot check)', async () => {
    const bank = await realBank();
    const clue = bank.find((c) => c.id === 'places-001');
    expect(clue).toBeDefined();
    expect(clue?.answer.trim().length).toBeGreaterThan(0);
    expect(clue?.source).toMatch(/^https?:\/\//);
  });
});
