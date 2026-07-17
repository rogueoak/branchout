import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, MAX_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults rounds when omitted', () => {
    expect(validateConfig({})).toEqual({ rounds: DEFAULT_ROUNDS });
    expect(validateConfig(undefined)).toEqual({ rounds: DEFAULT_ROUNDS });
  });

  it('accepts an in-range round count', () => {
    expect(validateConfig({ rounds: 2 })).toEqual({ rounds: 2 });
  });

  it('rejects a non-integer or out-of-range round count', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: MAX_ROUNDS + 1 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 1.5 })).toThrow(/rounds/);
  });
});
