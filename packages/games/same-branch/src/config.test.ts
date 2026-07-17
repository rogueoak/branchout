import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, DEFAULT_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults an empty config to random categories, default rounds, free mode', () => {
    const cfg = validateConfig({});
    expect(cfg).toEqual({ categories: 'random', rounds: DEFAULT_ROUNDS, mode: DEFAULT_MODE });
  });

  it('accepts a null config (treated as empty)', () => {
    expect(validateConfig(null).categories).toBe('random');
  });

  it('accepts 1-3 distinct known categories', () => {
    expect(validateConfig({ categories: ['senses', 'nature'] }).categories).toEqual([
      'senses',
      'nature',
    ]);
  });

  it('accepts coop mode', () => {
    expect(validateConfig({ mode: 'coop' }).mode).toBe('coop');
  });

  it('rejects an unknown category', () => {
    expect(() => validateConfig({ categories: ['nope'] })).toThrow(/unknown/);
  });

  it('rejects more than 3 categories', () => {
    expect(() => validateConfig({ categories: ['senses', 'nature', 'people', 'wild'] })).toThrow(
      /1-3/,
    );
  });

  it('rejects duplicate categories', () => {
    expect(() => validateConfig({ categories: ['senses', 'senses'] })).toThrow(/distinct/);
  });

  it('rejects a non-array, non-random categories value', () => {
    expect(() => validateConfig({ categories: 'senses' })).toThrow();
  });

  it('rejects rounds out of range', () => {
    expect(() => validateConfig({ rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 101 })).toThrow(/rounds/);
    expect(() => validateConfig({ rounds: 2.5 })).toThrow(/rounds/);
  });

  it('rejects an unknown mode', () => {
    expect(() => validateConfig({ mode: 'teams' })).toThrow(/mode/);
  });
});
