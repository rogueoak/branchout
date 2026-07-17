import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validatePromptBank, PROMPTS_FILE, type ZingerPrompt } from './prompts';

/** Load the shipped sample bank straight off disk, so the real data is validated too. */
async function loadShipped(): Promise<ZingerPrompt[]> {
  const path = fileURLToPath(new URL(`../${PROMPTS_FILE}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as ZingerPrompt[];
}

describe('validatePromptBank', () => {
  it('accepts a well-formed bank', () => {
    expect(() =>
      validatePromptBank([
        { id: 'prompt-001', setup: 'A setup: ___.' },
        { id: 'prompt-002', setup: 'Another setup: ___.' },
      ]),
    ).not.toThrow();
  });

  it('rejects a bad id format', () => {
    expect(() => validatePromptBank([{ id: 'p1', setup: 'x' }])).toThrow(/prompt-NNN/);
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      validatePromptBank([
        { id: 'prompt-001', setup: 'A' },
        { id: 'prompt-001', setup: 'B' },
      ]),
    ).toThrow(/duplicate id/);
  });

  it('rejects an empty setup', () => {
    expect(() => validatePromptBank([{ id: 'prompt-001', setup: '   ' }])).toThrow(/empty setup/);
  });

  it('rejects a duplicate setup', () => {
    expect(() =>
      validatePromptBank([
        { id: 'prompt-001', setup: 'Same thing' },
        { id: 'prompt-002', setup: 'same thing' },
      ]),
    ).toThrow(/duplicate setup/);
  });
});

describe('shipped sample bank', () => {
  it('is a non-empty, well-formed, ASCII bank', async () => {
    const bank = await loadShipped();
    expect(bank.length).toBeGreaterThanOrEqual(50);
    expect(() => validatePromptBank(bank)).not.toThrow();
    for (const prompt of bank) {
      // ASCII-only content (Trellis guideline).
      expect(/^[\x20-\x7e]+$/.test(prompt.setup)).toBe(true);
    }
  });
});
