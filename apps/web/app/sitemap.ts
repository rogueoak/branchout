import type { MetadataRoute } from 'next';
import { GAME_CATALOG, absoluteUrl, featurePath } from '../lib/games/catalog';

// The sitemap (spec 0030): the public, crawlable surfaces - the home page, the games index, every
// per-game feature page (generated from the catalog so a new game appears automatically), and the
// legal pages (spec 0031). Absolute URLs via SITE_URL (crawlers need absolute). Private/dynamic
// surfaces (rooms, account, join) are intentionally excluded and disallowed in robots.
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPaths = ['/', '/games', '/privacy', '/terms'];
  const gamePaths = GAME_CATALOG.map((game) => featurePath(game.slug));
  return [...staticPaths, ...gamePaths].map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.8,
  }));
}
