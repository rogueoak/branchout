import { describe, expect, it } from 'vitest';
import {
  BULLSEYE_POINTS,
  FAR_POINTS,
  MISS_POINTS,
  NEAR_POINTS,
  bandLabel,
  clampToBranch,
  scoreGuess,
} from './scoring';

describe('scoreGuess - closeness bands', () => {
  it('a bullseye (exact) scores 4', () => {
    expect(scoreGuess(50, 50)).toBe(BULLSEYE_POINTS);
  });

  it('within the bullseye radius (<= 4) scores 4', () => {
    expect(scoreGuess(50, 46)).toBe(BULLSEYE_POINTS);
    expect(scoreGuess(50, 54)).toBe(BULLSEYE_POINTS);
  });

  it('just outside the bullseye (5..10) scores 3', () => {
    expect(scoreGuess(50, 55)).toBe(NEAR_POINTS);
    expect(scoreGuess(50, 40)).toBe(NEAR_POINTS);
  });

  it('the far band (11..18) scores 2', () => {
    expect(scoreGuess(50, 61)).toBe(FAR_POINTS);
    expect(scoreGuess(50, 32)).toBe(FAR_POINTS);
  });

  it('a miss (> 18 away) scores 0', () => {
    expect(scoreGuess(50, 70)).toBe(MISS_POINTS);
    expect(scoreGuess(50, 0)).toBe(MISS_POINTS);
    expect(scoreGuess(50, 100)).toBe(MISS_POINTS);
  });

  it('bands are symmetric around the bud', () => {
    for (let d = 0; d <= 30; d++) {
      expect(scoreGuess(50, 50 + d)).toBe(scoreGuess(50, 50 - d));
    }
  });

  it('clamps out-of-range guesses onto the branch before scoring', () => {
    // A guess of 120 clamps to 100; distance from a bud at 98 is 2 -> bullseye.
    expect(scoreGuess(98, 120)).toBe(BULLSEYE_POINTS);
    // A guess of -20 clamps to 0; distance from a bud at 2 is 2 -> bullseye.
    expect(scoreGuess(2, -20)).toBe(BULLSEYE_POINTS);
  });
});

describe('band boundaries are exact', () => {
  it('4 away is still a bullseye, 5 away drops to close', () => {
    expect(scoreGuess(50, 54)).toBe(BULLSEYE_POINTS);
    expect(scoreGuess(50, 55)).toBe(NEAR_POINTS);
  });

  it('10 away is close, 11 away drops to near', () => {
    expect(scoreGuess(50, 60)).toBe(NEAR_POINTS);
    expect(scoreGuess(50, 61)).toBe(FAR_POINTS);
  });

  it('18 away is near, 19 away is a miss', () => {
    expect(scoreGuess(50, 68)).toBe(FAR_POINTS);
    expect(scoreGuess(50, 69)).toBe(MISS_POINTS);
  });
});

describe('bandLabel', () => {
  it('names each band', () => {
    expect(bandLabel(50, 50)).toBe('bullseye');
    expect(bandLabel(50, 57)).toBe('close');
    expect(bandLabel(50, 63)).toBe('near');
    expect(bandLabel(50, 90)).toBe('miss');
  });
});

describe('clampToBranch', () => {
  it('clamps below 0 and above 100', () => {
    expect(clampToBranch(-5)).toBe(0);
    expect(clampToBranch(150)).toBe(100);
    expect(clampToBranch(42)).toBe(42);
  });
});
