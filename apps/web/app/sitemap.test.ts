import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../lib/site';
import sitemap from './sitemap';

describe('sitemap', () => {
  it('lists the marketing surfaces (home, games index, every feature page, legal) as absolute URLs', () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of ['/', '/games', '/games/trivia', '/games/liar-liar', '/privacy', '/terms']) {
      expect(urls).toContain(`${SITE_URL}${path === '/' ? '/' : path}`);
    }
    // Every URL is absolute (crawlers need absolute URLs).
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//);
    }
    // No private/dynamic surfaces leak into the sitemap.
    expect(urls.some((u) => u.includes('/account') || u.includes('/join'))).toBe(false);
    expect(urls.some((u) => /\/rooms\//.test(u))).toBe(false);
  });
});
