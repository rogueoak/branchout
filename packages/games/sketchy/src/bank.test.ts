import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATEGORIES, validateSeedBank, type SketchySeed } from './seeds';

// The shipped SAMPLE seed bank under data/ must be structurally valid and reasonably sized, so the
// game boots and a small game (3-8 players over a couple of cycles) never runs out of seeds.
describe('shipped seed bank sample', () => {
  it('loads, validates, and carries a usable number of seeds', async () => {
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sketchy');
    const all: SketchySeed[] = [];
    for (const category of CATEGORIES) {
      const raw = await readFile(join(dataDir, `${category}.json`), 'utf8');
      const parsed = JSON.parse(raw) as SketchySeed[];
      expect(Array.isArray(parsed)).toBe(true);
      all.push(...parsed);
    }
    expect(() => validateSeedBank(all)).not.toThrow();
    // A room of up to 8 players over 2 cycles needs 16 distinct seeds; the sample carries far more.
    expect(all.length).toBeGreaterThanOrEqual(100);
  });
});
