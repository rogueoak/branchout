import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, MAX_ROUNDS, defaultSketchyConfig, validateSketchyConfig } from './config';

describe('validateSketchyConfig', () => {
  it('accepts the default config', () => {
    expect(validateSketchyConfig(defaultSketchyConfig())).toEqual([]);
    expect(defaultSketchyConfig().rounds).toBe(DEFAULT_ROUNDS);
  });

  it('rejects an out-of-range or non-integer round count', () => {
    expect(validateSketchyConfig({ rounds: 0 })).toHaveLength(1);
    expect(validateSketchyConfig({ rounds: MAX_ROUNDS + 1 })).toHaveLength(1);
    expect(validateSketchyConfig({ rounds: 2.5 })).toHaveLength(1);
    expect(validateSketchyConfig({ rounds: 2 })).toEqual([]);
  });
});
