import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recallPlayerName, rememberPlayerName } from './membership';

// jsdom here ships no localStorage, so back it with a plain Map for these tests.
beforeEach(() => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as Storage;
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
});

afterEach(() => window.localStorage.clear());

describe('player-name memory (spec 0066)', () => {
  it('recalls the name it remembered', () => {
    rememberPlayerName('Prickly Ostrich');
    expect(recallPlayerName()).toBe('Prickly Ostrich');
  });

  it('returns null when nothing was remembered', () => {
    expect(recallPlayerName()).toBeNull();
  });

  it('trims on remember and on recall', () => {
    rememberPlayerName('  Mossy Otter  ');
    expect(recallPlayerName()).toBe('Mossy Otter');
    expect(window.localStorage.getItem('branchout:playerName')).toBe('Mossy Otter');
  });

  it('ignores a blank name rather than storing an empty default', () => {
    rememberPlayerName('Fuzzy Newt');
    rememberPlayerName('   ');
    expect(recallPlayerName()).toBe('Fuzzy Newt');
  });

  it('persists across rooms in localStorage (a cross-visit convenience)', () => {
    rememberPlayerName('Sunny Robin');
    expect(window.localStorage.getItem('branchout:playerName')).toBe('Sunny Robin');
  });
});
