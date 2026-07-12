// Loads the public SAMPLE clue bank from disk and runs the structural validator. This is the
// path-resolution guard: it proves the fs asset loader, rooted at this package via import.meta.url,
// resolves the package's own data/liar-liar files - the same resolution the engine relies on at boot.
// The full research-sourced bank ships from the private data repo mounted at GAME_DATA_DIR.

import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import { CATEGORIES, loadClueBank, validateClueBank, type LiarLiarClue } from './index';

async function sampleBank(): Promise<LiarLiarClue[]> {
  const assets = createFsAssetLoaderFactory().forModule(import.meta.url);
  return loadClueBank(assets);
}

describe('liar-liar sample clue bank (real data)', () => {
  it('loads a non-empty sample from the package data dir and passes the structural validator', async () => {
    const bank = await sampleBank();
    expect(bank.length).toBeGreaterThan(0);
    expect(() => validateClueBank(bank)).not.toThrow();
  });

  it('carries every category and only known categories', async () => {
    const bank = await sampleBank();
    const present = new Set(bank.map((c) => c.category));
    for (const category of CATEGORIES) {
      expect(present.has(category), `${category} present`).toBe(true);
    }
    expect(present).toEqual(new Set(CATEGORIES));
  });

  it('carries real, sourced clues (spot check)', async () => {
    const bank = await sampleBank();
    const clue = bank.find((c) => c.id === 'places-001');
    expect(clue).toBeDefined();
    expect(clue?.answer.trim().length).toBeGreaterThan(0);
    expect(clue?.source).toMatch(/^https?:\/\//);
  });
});
