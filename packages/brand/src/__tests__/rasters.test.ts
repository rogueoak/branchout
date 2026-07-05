import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../../dist');

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
