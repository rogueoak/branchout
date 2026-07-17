// Loads the public SAMPLE card bank from disk and runs the structural validator. This is the
// path-resolution guard: it proves the fs asset loader, rooted at this package via import.meta.url,
// resolves the package's own data/brambles files - the same resolution the engine relies on at boot.
// The full bank would ship from the private data repo mounted at GAME_DATA_DIR (spec 0041).

import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  CATEGORIES,
  loadCardBank,
  THORNS_PER_CARD,
  validateCardBank,
  type BramblesCard,
} from './index';

async function sampleBank(): Promise<BramblesCard[]> {
  const assets = createFsAssetLoaderFactory().forModule(import.meta.url);
  return loadCardBank(assets);
}

describe('brambles sample card bank (real data)', () => {
  it('loads a large sample from the package data dir and passes the structural validator', async () => {
    const bank = await sampleBank();
    // A "~200-card sample" is bundled; assert it is substantial and well-formed.
    expect(bank.length).toBeGreaterThanOrEqual(150);
    expect(() => validateCardBank(bank)).not.toThrow();
  });

  it('carries every category and only known categories', async () => {
    const bank = await sampleBank();
    const present = new Set(bank.map((c) => c.category));
    for (const category of CATEGORIES) {
      expect(present.has(category), `${category} present`).toBe(true);
    }
    expect(present).toEqual(new Set(CATEGORIES));
  });

  it('every card carries a bloom and exactly five thorns (spot check)', async () => {
    const bank = await sampleBank();
    const card = bank.find((c) => c.id === 'nature-001');
    expect(card).toBeDefined();
    expect(card?.bloom.trim().length).toBeGreaterThan(0);
    expect(card?.thorns).toHaveLength(THORNS_PER_CARD);
  });
});
