import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildBrand } from '@rogueoak/roots/brand';

// Build the Confetti brand into a throwaway dir so the test proves the pipeline end to end.
// `buildBrand` runs canopy's OWN AA guard and role-coverage check and THROWS on any break, so a
// resolved build is itself the AA + completeness assertion; the checks below pin the coverage
// contract (every canopy role present in BOTH themes) so a silent regression can't slip through.
const here = dirname(fileURLToPath(import.meta.url));
const tokens = resolve(here, '..', 'tokens');
const outDir = mkdtempSync(join(tmpdir(), 'confetti-brand-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// Extract the declaration block of the rule whose selector is EXACTLY `selector`. Throws when the
// selector is absent so a missing `.dark` block fails loudly instead of silently falling back to
// the `:root` block at index 0 (which would let the dark-coverage test false-pass).
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`brand.css has no \`${selector}\` block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const built = await buildBrand({
  name: 'confetti',
  primitives: [resolve(tokens, 'primitive.json')],
  semantic: resolve(tokens, 'semantic.json'),
  semanticDark: resolve(tokens, 'semantic.dark.json'),
  outFile: join(outDir, 'brand.css'),
});

describe('Confetti brand.css', () => {
  it('maps every canopy semantic role and passes AA in light and dark', () => {
    // A resolved buildBrand means AA held in both themes and no role was left unmapped.
    expect(built.roles.length).toBeGreaterThan(0);
    expect(built.selectors).toEqual({ light: ':root', dark: '.dark' });
  });

  it('covers every role in the :root (light) block', () => {
    const light = block(built.css, ':root');
    for (const role of built.roles) {
      expect(light, `light block is missing --${role}`).toContain(`--${role}:`);
    }
  });

  it('covers every role in the .dark block', () => {
    const dark = block(built.css, '.dark');
    for (const role of built.roles) {
      expect(dark, `.dark block is missing --${role}`).toContain(`--${role}:`);
    }
  });

  it('declares the Confetti primitive ramps as literal hexes in :root', () => {
    const light = block(built.css, ':root').toLowerCase();
    // grape (primary), bubblegum (secondary), sunbeam (accent) anchors, case-insensitive.
    expect(light).toContain('#7c3aed');
    expect(light).toContain('#ec4899');
    expect(light).toContain('#facc15');
  });
});
