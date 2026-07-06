import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../../dist');

// Self-contained: generate the rasters first, so running vitest directly (not only via
// `turbo run test` after the build task) still finds the files.
beforeAll(() => {
  execSync('node scripts/generate-rasters.mjs', { cwd: join(__dirname, '../..') });
});

describe('favicon/OG raster generation', () => {
  it.each([
    ['favicon-16.png', 16, 16],
    ['favicon-32.png', 32, 32],
    ['favicon-180.png', 180, 180],
    ['og-1200x630.png', 1200, 630],
  ] as const)('%s exists with correct dimensions', async (filename, width, height) => {
    const filepath = join(distDir, filename);
    expect(existsSync(filepath), `${filename} not found - run build first`).toBe(true);
    const meta = await sharp(filepath).metadata();
    expect(meta.width).toBe(width);
    expect(meta.height).toBe(height);
  });
});
