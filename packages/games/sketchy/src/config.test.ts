import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADVANCE_AFTER_SECONDS,
  DEFAULT_ROUNDS,
  MAX_ADVANCE_AFTER_SECONDS,
  MAX_ROUNDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MIN_ROUNDS,
  validateConfig,
} from './config';

describe('validateConfig', () => {
  it('defaults rounds and auto-advance when omitted', () => {
    // Fresh defaults: 5 rounds, auto-advance on at a 5s dwell (spec 0068, mirroring Trivia).
    expect(DEFAULT_ROUNDS).toBe(5);
    expect(validateConfig({})).toEqual({
      rounds: DEFAULT_ROUNDS,
      autoAdvance: true,
      advanceAfterMs: DEFAULT_ADVANCE_AFTER_SECONDS * 1000,
    });
    expect(validateConfig(undefined)).toEqual({
      rounds: DEFAULT_ROUNDS,
      autoAdvance: true,
      advanceAfterMs: 5_000,
    });
  });

  it('accepts an in-range round count, including both boundaries', () => {
    expect(validateConfig({ rounds: 2 })).toMatchObject({ rounds: 2 });
    // Both ends of the accept range: MIN (1) and Marathon (MAX = 15).
    expect(validateConfig({ rounds: MIN_ROUNDS })).toMatchObject({ rounds: 1 });
    expect(validateConfig({ rounds: MAX_ROUNDS })).toMatchObject({ rounds: 15 });
  });

  it('rejects a non-integer or out-of-range round count', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: MAX_ROUNDS + 1 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 1.5 })).toThrow(/rounds/);
  });

  it('resolves the advance-after dwell to milliseconds, accepting both boundaries', () => {
    expect(validateConfig({ advanceAfterSeconds: 12 }).advanceAfterMs).toBe(12_000);
    // Both ends of the accept range (1-60) must pass, so an off-by-one in the bound is caught.
    expect(validateConfig({ advanceAfterSeconds: MIN_ADVANCE_AFTER_SECONDS }).advanceAfterMs).toBe(
      1_000,
    );
    expect(validateConfig({ advanceAfterSeconds: MAX_ADVANCE_AFTER_SECONDS }).advanceAfterMs).toBe(
      60_000,
    );
  });

  it('rejects an out-of-range or non-integer advance-after dwell', () => {
    expect(() => validateConfig({ advanceAfterSeconds: 0 })).toThrow(/advanceAfterSeconds/);
    expect(() => validateConfig({ advanceAfterSeconds: 61 })).toThrow(/advanceAfterSeconds/);
    expect(() => validateConfig({ advanceAfterSeconds: 5.5 })).toThrow(/advanceAfterSeconds/);
  });

  it('carries auto-advance off through', () => {
    expect(validateConfig({ autoAdvance: false })).toMatchObject({ autoAdvance: false });
  });

  it('rejects a non-boolean auto-advance', () => {
    expect(() => validateConfig({ autoAdvance: 'yes' as unknown as boolean })).toThrow(
      /autoAdvance/,
    );
  });
});
