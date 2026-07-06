import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Assumes this package lives at <repo>/packages/brand, so ../../.. is the monorepo root (the
// theme package follows the same convention). If the package moves, update this path.
const root = join(__dirname, '../../..');
const distDir = join(__dirname, '../dist');
const webPublic = join(root, 'apps/web/public');

mkdirSync(distDir, { recursive: true });
mkdirSync(webPublic, { recursive: true });

const faviconSvg = readFileSync(join(root, 'assets/branchout-favicon.svg'));
const iconSvg = readFileSync(join(root, 'assets/branchout-icon.svg'));

// Favicon sizes from the favicon mark
for (const size of [16, 32, 180]) {
  const outFile = join(distDir, `favicon-${size}.png`);
  await sharp(faviconSvg).resize(size, size).png().toFile(outFile);
  console.log(`Generated ${outFile}`);
}

// OG image: 1200x630 dark background (#0d0a15) with icon centered at 480px
const iconSize = 480;
const ogWidth = 1200;
const ogHeight = 630;

const iconPng = await sharp(iconSvg).resize(iconSize, iconSize).png().toBuffer();

const ogFile = join(distDir, 'og-1200x630.png');
await sharp({
  create: {
    width: ogWidth,
    height: ogHeight,
    channels: 4,
    background: { r: 13, g: 10, b: 21, alpha: 1 },
  },
})
  .composite([
    {
      input: iconPng,
      top: Math.round((ogHeight - iconSize) / 2),
      left: Math.round((ogWidth - iconSize) / 2),
    },
  ])
  .png()
  .toFile(ogFile);
console.log(`Generated ${ogFile}`);

// Copy to apps/web/public for Next.js static serving
copyFileSync(join(distDir, 'favicon-16.png'), join(webPublic, 'favicon-16.png'));
copyFileSync(join(distDir, 'favicon-32.png'), join(webPublic, 'favicon-32.png'));
copyFileSync(join(distDir, 'favicon-180.png'), join(webPublic, 'apple-touch-icon.png'));
copyFileSync(ogFile, join(webPublic, 'og.png'));
console.log('Copied brand assets to apps/web/public/');
