import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, MAX_ROUNDS, MIN_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults rounds when omitted', () => {
    expect(validateConfig({})).toEqual({ rounds: DEFAULT_ROUNDS });
    expect(validateConfig(undefined)).toEqual({ rounds: DEFAULT_ROUNDS });
  });

  it('accepts an in-range round count', () => {
    expect(validateConfig({ rounds: 5 })).toEqual({ rounds: 5 });
    expect(validateConfig({ rounds: MIN_ROUNDS })).toEqual({ rounds: MIN_ROUNDS });
    expect(validateConfig({ rounds: MAX_ROUNDS })).toEqual({ rounds: MAX_ROUNDS });
  });

  it('throws on an out-of-range or non-integer round count', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: MAX_ROUNDS + 1 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 2.5 })).toThrow(/rounds/);
  });
});
