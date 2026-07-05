import { describe, expect, it } from 'vitest';
import { validateNickname } from './nickname';

describe('nickname validation', () => {
  it('accepts free-form display text and trims it', () => {
    const result = validateNickname('  Captain Chaos ');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('Captain Chaos');
  });

  it('allows punctuation and mixed case (it is display text, not a handle)', () => {
    expect(validateNickname('The Great, Gonzo!').ok).toBe(true);
  });

  it('rejects an empty nickname', () => {
    expect(validateNickname('   ').ok).toBe(false);
  });

  it('rejects a nickname over the max length', () => {
    expect(validateNickname('n'.repeat(41)).ok).toBe(false);
  });

  it('rejects control characters', () => {
    const newline = String.fromCharCode(10);
    const nullByte = String.fromCharCode(0);
    expect(validateNickname(`line${newline}break`).ok).toBe(false);
    expect(validateNickname(`null${nullByte}byte`).ok).toBe(false);
  });
});
