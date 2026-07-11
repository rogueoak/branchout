import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/games/catalog';

// robots.txt (spec 0030): let crawlers into the marketing surfaces and point them at the sitemap;
// keep them out of the private/dynamic surfaces (a specific room, the account page, the join target).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/rooms/', '/join'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
