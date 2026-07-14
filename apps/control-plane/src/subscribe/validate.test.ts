import { describe, expect, it } from 'vitest';
import { splitName, validateSubscribe } from './validate';

describe('validateSubscribe', () => {
  it('normalizes a valid email (trim + lowercase) and keeps an optional name', () => {
    const r = validateSubscribe({ email: '  Ada@Example.COM ', name: '  Ada Lovelace ' });
    expect(r).toEqual({ ok: true, data: { email: 'ada@example.com', name: 'Ada Lovelace' } });
  });

  it('accepts a missing/empty name (name is optional)', () => {
    expect(validateSubscribe({ email: 'a@b.com' })).toEqual({
      ok: true,
      data: { email: 'a@b.com', name: '' },
    });
  });

  it('rejects an invalid email with a generic message', () => {
    const r = validateSubscribe({ email: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Please enter a valid email address.');
    }
  });

  it('rejects a non-string / missing email', () => {
    expect(validateSubscribe({ email: 42 }).ok).toBe(false);
    expect(validateSubscribe({}).ok).toBe(false);
  });

  it('caps an over-long name at the field limit', () => {
    const long = 'x'.repeat(500);
    const r = validateSubscribe({ email: 'a@b.com', name: long });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name.length).toBe(100);
    }
  });
});

describe('splitName', () => {
  it('splits the first token as first name and the rest as last name', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('folds a middle name into the last name', () => {
    expect(splitName('Ada B Lovelace')).toEqual({ firstName: 'Ada', lastName: 'B Lovelace' });
  });

  it('returns {} for an empty or whitespace name', () => {
    expect(splitName('')).toEqual({});
    expect(splitName('   ')).toEqual({});
    expect(splitName(undefined)).toEqual({});
  });

  it('collapses internal whitespace', () => {
    expect(splitName('  Ada    Lovelace  ')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });
});
