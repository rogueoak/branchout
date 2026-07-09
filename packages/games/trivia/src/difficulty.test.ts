import { describe, expect, it } from 'vitest';
import {
  isValidDifficultyBound,
  isValidDifficultyRange,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
} from './difficulty';

describe('isValidDifficultyBound', () => {
  it('accepts integers 1-10 and rejects everything else', () => {
    for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d += 1)
      expect(isValidDifficultyBound(d)).toBe(true);
    expect(isValidDifficultyBound(0)).toBe(false);
    expect(isValidDifficultyBound(11)).toBe(false);
    expect(isValidDifficultyBound(5.5)).toBe(false);
    expect(isValidDifficultyBound(Number.NaN)).toBe(false);
  });
});

describe('isValidDifficultyRange', () => {
  it('accepts a valid ordered range, including a single-value range', () => {
    expect(isValidDifficultyRange(4, 6)).toBe(true);
    expect(isValidDifficultyRange(1, 10)).toBe(true);
    expect(isValidDifficultyRange(5, 5)).toBe(true);
  });

  it('rejects an inverted range or an out-of-bounds bound', () => {
    expect(isValidDifficultyRange(6, 4)).toBe(false);
    expect(isValidDifficultyRange(0, 6)).toBe(false);
    expect(isValidDifficultyRange(4, 11)).toBe(false);
    expect(isValidDifficultyRange(4.5, 6)).toBe(false);
  });
});
