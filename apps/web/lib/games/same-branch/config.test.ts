import { describe, expect, it } from 'vitest';
import { defaultSameBranchConfig, validateSameBranchConfig } from './config';

describe('validateSameBranchConfig', () => {
  it('the default config is valid', () => {
    expect(validateSameBranchConfig(defaultSameBranchConfig())).toEqual([]);
  });

  it('accepts coop mode and 1-3 categories', () => {
    expect(
      validateSameBranchConfig({ categories: ['senses', 'wild'], rounds: 4, mode: 'coop' }),
    ).toEqual([]);
  });

  it('flags rounds out of range', () => {
    expect(validateSameBranchConfig({ categories: 'random', rounds: 0, mode: 'free' })).toEqual([
      { field: 'rounds', message: expect.stringMatching(/Rounds/) },
    ]);
  });

  it('flags too many categories', () => {
    const errors = validateSameBranchConfig({
      categories: ['senses', 'wild', 'nature', 'people'],
      rounds: 3,
      mode: 'free',
    });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('flags an empty category list', () => {
    const errors = validateSameBranchConfig({ categories: [], rounds: 3, mode: 'free' });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('flags a duplicate category', () => {
    const errors = validateSameBranchConfig({
      categories: ['senses', 'senses'],
      rounds: 3,
      mode: 'free',
    });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('flags a bad mode', () => {
    const errors = validateSameBranchConfig({
      categories: 'random',
      rounds: 3,
      // @ts-expect-error deliberately invalid
      mode: 'teams',
    });
    expect(errors.some((e) => e.field === 'mode')).toBe(true);
  });
});
