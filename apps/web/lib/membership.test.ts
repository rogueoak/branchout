import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  recallAnonName,
  recallPlayerName,
  rememberAnonName,
  rememberPlayerName,
} from './membership';

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

  it('keeps the most recently picked name (last pick wins across visits)', () => {
    rememberPlayerName('Sunny Robin');
    rememberPlayerName('Mossy Otter');
    expect(recallPlayerName()).toBe('Mossy Otter');
  });
});

describe('anonymous-default memory (spec 0066)', () => {
  it('recalls the anon default under a DISTINCT key from the picked name', () => {
    rememberAnonName('Prickly Ostrich');
    expect(recallAnonName()).toBe('Prickly Ostrich');
    expect(window.localStorage.getItem('branchout:anonName')).toBe('Prickly Ostrich');
    // Crucially it does NOT bleed into the picked-name slot, so it can never shadow a gamer tag.
    expect(window.localStorage.getItem('branchout:playerName')).toBeNull();
    expect(recallPlayerName()).toBeNull();
  });

  it('keeps the anon default and the picked name independent of each other', () => {
    rememberAnonName('Prickly Ostrich');
    rememberPlayerName('Ada');
    expect(recallAnonName()).toBe('Prickly Ostrich');
    expect(recallPlayerName()).toBe('Ada');
  });

  it('returns null when no anon default was remembered', () => {
    expect(recallAnonName()).toBeNull();
  });

  it('ignores a blank anon name rather than storing an empty default', () => {
    rememberAnonName('Fuzzy Newt');
    rememberAnonName('   ');
    expect(recallAnonName()).toBe('Fuzzy Newt');
  });
});
