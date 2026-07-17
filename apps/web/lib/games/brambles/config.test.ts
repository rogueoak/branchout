import { describe, expect, it } from 'vitest';
import { defaultBramblesConfig, validateBramblesConfig } from './config';

describe('validateBramblesConfig', () => {
  it('accepts the default config', () => {
    expect(validateBramblesConfig(defaultBramblesConfig())).toEqual([]);
  });

  it('flags an odd sprint count', () => {
    const errors = validateBramblesConfig({ sprints: 3, sprintSeconds: 60 });
    expect(errors.some((e) => e.field === 'sprints' && /even/.test(e.message))).toBe(true);
  });

  it('flags out-of-range sprints and seconds', () => {
    const errors = validateBramblesConfig({ sprints: 0, sprintSeconds: 5 });
    expect(errors.some((e) => e.field === 'sprints')).toBe(true);
    expect(errors.some((e) => e.field === 'sprintSeconds')).toBe(true);
  });
});
