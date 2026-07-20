import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADVANCE_AFTER_SECONDS,
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
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

  it('accepts an in-range round count', () => {
    expect(validateConfig({ rounds: 2 })).toMatchObject({ rounds: 2 });
    // Marathon (15) is now in range.
    expect(validateConfig({ rounds: MAX_ROUNDS })).toMatchObject({ rounds: 15 });
  });

  it('rejects a non-integer or out-of-range round count', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: MAX_ROUNDS + 1 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 1.5 })).toThrow(/rounds/);
  });

  it('resolves the advance-after dwell to milliseconds', () => {
    expect(validateConfig({ advanceAfterSeconds: 12 }).advanceAfterMs).toBe(12_000);
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
