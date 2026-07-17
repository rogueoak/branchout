import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  CATEGORIES,
  MIN_PERCHES,
  loadRoostBank,
  validateRoostBank,
  type OddBirdRoost,
} from './roosts';

/** A well-formed roost with a full perch list, for mutating in the negative cases. */
function goodRoost(over: Partial<OddBirdRoost> = {}): OddBirdRoost {
  return {
    id: 'everyday-001',
    category: 'everyday',
    name: 'A busy coffee shop',
    perches: ['Barista', 'Regular', 'Newcomer', 'Baker', 'Manager', 'Courier', 'Inspector'],
    ...over,
  };
}

describe('Odd Bird roost bank', () => {
  it('loads every shipped category file and yields well-formed roosts', async () => {
    const assets = createFsAssetLoaderFactory().forModule(import.meta.url);
    const bank = await loadRoostBank(assets);
    expect(bank.length).toBeGreaterThanOrEqual(30);
    // The shipped bank passes its own structural validator.
    expect(() => validateRoostBank(bank)).not.toThrow();
    // Every category is represented and every roost seats the largest flock.
    for (const category of CATEGORIES) {
      expect(bank.some((r) => r.category === category)).toBe(true);
    }
    for (const roost of bank) {
      expect(roost.perches.length).toBeGreaterThanOrEqual(MIN_PERCHES);
    }
  });

  it('accepts a minimal well-formed bank', () => {
    expect(() => validateRoostBank([goodRoost()])).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() => validateRoostBank([goodRoost(), goodRoost()])).toThrow(/duplicate id/);
  });

  it('rejects an id that does not match <category>-NNN', () => {
    expect(() => validateRoostBank([goodRoost({ id: 'everyday-1' })])).toThrow(/must match/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateRoostBank([goodRoost({ id: 'nope-001', category: 'nope' })])).toThrow(
      /expected one of/,
    );
  });

  it('rejects too few perches', () => {
    expect(() => validateRoostBank([goodRoost({ perches: ['A', 'B', 'C'] })])).toThrow(/at least/);
  });

  it('rejects a duplicate perch', () => {
    expect(() =>
      validateRoostBank([goodRoost({ perches: ['Barista', 'Barista', 'C', 'D', 'E', 'F', 'G'] })]),
    ).toThrow(/duplicate perch/);
  });

  it('rejects a duplicate roost name in the same category', () => {
    expect(() => validateRoostBank([goodRoost(), goodRoost({ id: 'everyday-002' })])).toThrow(
      /duplicate name/,
    );
  });
});
