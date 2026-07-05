import { describe, expect, it } from 'vitest';
import { validateDisplayName } from './display-name';

describe('display-name validation', () => {
  it('accepts free-form display text and trims it', () => {
    const result = validateDisplayName('  Captain Chaos ');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('Captain Chaos');
  });

  it('allows punctuation and mixed case (it is display text, not a handle)', () => {
    expect(validateDisplayName('The Great, Gonzo!').ok).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(validateDisplayName('   ').ok).toBe(false);
  });

  it('rejects a name over the max length', () => {
    expect(validateDisplayName('n'.repeat(41)).ok).toBe(false);
  });

  it('rejects control characters', () => {
    const newline = String.fromCharCode(10);
    const nullByte = String.fromCharCode(0);
    expect(validateDisplayName(`line${newline}break`).ok).toBe(false);
    expect(validateDisplayName(`null${nullByte}byte`).ok).toBe(false);
  });
});
