import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRINTS, DEFAULT_SPRINT_SECONDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults an empty config', () => {
    expect(validateConfig({})).toEqual({
      sprints: DEFAULT_SPRINTS,
      sprintSeconds: DEFAULT_SPRINT_SECONDS,
    });
    expect(validateConfig(undefined)).toEqual({
      sprints: DEFAULT_SPRINTS,
      sprintSeconds: DEFAULT_SPRINT_SECONDS,
    });
  });

  it('accepts a valid even sprint count and duration', () => {
    expect(validateConfig({ sprints: 4, sprintSeconds: 90 })).toEqual({
      sprints: 4,
      sprintSeconds: 90,
    });
  });

  it('rejects an odd sprint count (teams must get equal turns)', () => {
    expect(() => validateConfig({ sprints: 3 })).toThrow(/even/);
  });

  it('rejects out-of-range sprints', () => {
    expect(() => validateConfig({ sprints: 0 })).toThrow(/sprints/);
    expect(() => validateConfig({ sprints: 100 })).toThrow(/sprints/);
  });

  it('rejects out-of-range sprint seconds', () => {
    expect(() => validateConfig({ sprintSeconds: 10 })).toThrow(/sprintSeconds/);
    expect(() => validateConfig({ sprintSeconds: 999 })).toThrow(/sprintSeconds/);
  });
});
