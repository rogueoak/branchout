import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestServices } from '@branchout/game-sdk/testing';
import { CATEGORIES, loadSpectrumBank, validateSpectrumBank, type Spectrum } from './spectrums';

function ok(id: string, category: string, left: string, right: string): Spectrum {
  return { id, category, left, right };
}

describe('validateSpectrumBank', () => {
  it('accepts a well-formed bank', () => {
    expect(() =>
      validateSpectrumBank([
        ok('senses-001', 'senses', 'cold', 'hot'),
        ok('nature-001', 'nature', 'a puddle', 'an ocean'),
      ]),
    ).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      validateSpectrumBank([
        ok('senses-001', 'senses', 'cold', 'hot'),
        ok('senses-001', 'senses', 'quiet', 'loud'),
      ]),
    ).toThrow(/duplicate id/);
  });

  it('rejects an id that does not match <category>-NNN', () => {
    expect(() => validateSpectrumBank([ok('senses-1', 'senses', 'cold', 'hot')])).toThrow(
      /must match/,
    );
    expect(() => validateSpectrumBank([ok('nature-001', 'senses', 'cold', 'hot')])).toThrow(
      /must match/,
    );
  });

  it('rejects an unknown category', () => {
    expect(() => validateSpectrumBank([ok('smell-001', 'smell', 'a', 'b')])).toThrow(
      /expected one of/,
    );
  });

  it('rejects an empty end', () => {
    expect(() => validateSpectrumBank([ok('senses-001', 'senses', '', 'hot')])).toThrow(/left/);
    expect(() => validateSpectrumBank([ok('senses-001', 'senses', 'cold', '  ')])).toThrow(/right/);
  });

  it('rejects identical ends', () => {
    expect(() => validateSpectrumBank([ok('senses-001', 'senses', 'Cold', 'cold')])).toThrow(
      /identical/,
    );
  });

  it('rejects a duplicate pair within a category', () => {
    expect(() =>
      validateSpectrumBank([
        ok('senses-001', 'senses', 'cold', 'hot'),
        ok('senses-002', 'senses', 'Cold', 'Hot'),
      ]),
    ).toThrow(/duplicate pair/);
  });
});

describe('the shipped sample bank', () => {
  it('loads and validates the real shipped data/ files', async () => {
    // Read the real data/ files off disk (as the engine would at boot) into an in-memory loader, then
    // load + validate through the module's own loader/validator.
    const files: Record<string, unknown> = {};
    for (const category of CATEGORIES) {
      const url = new URL(`../data/same-branch/${category}.json`, import.meta.url);
      files[`data/same-branch/${category}.json`] = JSON.parse(
        readFileSync(fileURLToPath(url), 'utf8'),
      );
    }
    const bank = await loadSpectrumBank(createTestServices({ files }).assets.forModule('x'));
    expect(bank.length).toBeGreaterThanOrEqual(120);
    expect(() => validateSpectrumBank(bank)).not.toThrow();
  });
});
