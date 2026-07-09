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
const logoSvg = readFileSync(join(root, 'assets/branchout-logo.svg'));
const iconSvg = readFileSync(join(root, 'assets/branchout-icon.svg'));
const triviaSvg = readFileSync(join(root, 'assets/game-trivia.svg'));
const liarLiarSvg = readFileSync(join(root, 'assets/game-liarliar.svg'));

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
// The canvas dark, matching BRAND.md (#0d0a15).
const CANVAS = { r: 13, g: 10, b: 21, alpha: 1 };
const SYSTEM_FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;

function canvas() {
  return sharp({
    create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 4, background: CANVAS },
  });
}

// Favicon sizes from the favicon mark.
for (const size of [16, 32, 180]) {
  const outFile = join(distDir, `favicon-${size}.png`);
  await sharp(faviconSvg).resize(size, size).png().toFile(outFile);
  console.log(`Generated ${outFile}`);
}

// Home OG card: the wordmark lockup (mark + "Branch out" + tagline) centered on the canvas. This
// is the "logo and tagline" card the marketing pages unfurl with.
const logoWidth = 900;
const logoPng = await sharp(logoSvg).resize({ width: logoWidth }).png().toBuffer();
const logoMeta = await sharp(logoPng).metadata();

const homeOgFile = join(distDir, 'og-1200x630.png');
await canvas()
  .composite([
    {
      input: logoPng,
      left: Math.round((OG_WIDTH - logoWidth) / 2),
      top: Math.round((OG_HEIGHT - logoMeta.height) / 2),
    },
  ])
  .png()
  .toFile(homeOgFile);
console.log(`Generated ${homeOgFile}`);

// Share cards: a game's title art as the backdrop, "Join my game" overlaid over a bottom scrim,
// and the small Branch out mark in the top-left safe area. Pre-rendered per game (plus a generic
// fallback) so a /join link unfurls instantly - the web app only picks which card to point at.
async function buildShareCard(gameSvg, outName) {
  const artSize = 400;
  const artPng = await sharp(gameSvg).resize(artSize, artSize).png().toBuffer();
  const markSize = 84;
  const markPng = await sharp(faviconSvg).resize(markSize, markSize).png().toBuffer();

  // Overlay: a bottom scrim for legibility plus the "Join my game" headline and a subtitle.
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <defs>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d0a15" stop-opacity="0"/>
          <stop offset="0.55" stop-color="#0d0a15" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#0d0a15" stop-opacity="0.96"/>
        </linearGradient>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FBBF24"/><stop offset="0.5" stop-color="#EC4899"/><stop offset="1" stop-color="#7C3AED"/>
        </linearGradient>
      </defs>
      <rect x="0" y="330" width="${OG_WIDTH}" height="300" fill="url(#scrim)"/>
      <text x="600" y="520" text-anchor="middle" font-family="${SYSTEM_FONT}" font-size="88" font-weight="800" letter-spacing="-1.5" fill="#f7f6fa">Join my game</text>
      <rect x="500" y="548" width="200" height="4" rx="2" fill="url(#spark)"/>
      <text x="600" y="590" text-anchor="middle" font-family="${SYSTEM_FONT}" font-size="30" font-weight="500" letter-spacing="0.2" fill="#b9b3c9">Tap to join on Branch out</text>
    </svg>`,
  );

  const outFile = join(distDir, outName);
  await canvas()
    .composite([
      { input: artPng, left: Math.round((OG_WIDTH - artSize) / 2), top: 70 },
      { input: overlay, left: 0, top: 0 },
      { input: markPng, left: 64, top: 52 },
    ])
    .png()
    .toFile(outFile);
  console.log(`Generated ${outFile}`);
  return outFile;
}

const shareTrivia = await buildShareCard(triviaSvg, 'share-trivia.png');
const shareLiarLiar = await buildShareCard(liarLiarSvg, 'share-liarliar.png');
// Generic fallback for a room with no game picked yet (or an unknown/expired code): the house mark.
const shareJoin = await buildShareCard(iconSvg, 'share-join.png');

// Copy to apps/web/public for Next.js static serving.
copyFileSync(join(distDir, 'favicon-16.png'), join(webPublic, 'favicon-16.png'));
copyFileSync(join(distDir, 'favicon-32.png'), join(webPublic, 'favicon-32.png'));
copyFileSync(join(distDir, 'favicon-180.png'), join(webPublic, 'apple-touch-icon.png'));
copyFileSync(homeOgFile, join(webPublic, 'og.png'));
copyFileSync(shareTrivia, join(webPublic, 'share-trivia.png'));
copyFileSync(shareLiarLiar, join(webPublic, 'share-liarliar.png'));
copyFileSync(shareJoin, join(webPublic, 'share-join.png'));
console.log('Copied brand assets to apps/web/public/');
