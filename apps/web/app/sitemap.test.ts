import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../lib/site';
import sitemap from './sitemap';

describe('sitemap', () => {
  it('lists the marketing surfaces (home, games index, every feature page, legal) as absolute URLs', () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const path of [
      '/',
      '/games',
      '/games/trivia',
      '/games/liar-liar',
      '/games/lone-leaf',
      '/games/reversi',
      '/games/checkers',
      '/privacy',
      '/terms',
    ]) {
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

  it('never lists an insider-only game (the security-critical public/insider partition, spec 0043)', () => {
    // The sitemap enumerates PUBLIC_GAME_CATALOG, so an insider-only slug must be absent - it must
    // never exist on the public site. A regression that enumerated the full catalog would leak these.
    const urls = sitemap().map((entry) => entry.url);
    for (const insiderSlug of ['teeter-tower', 'zinger']) {
      expect(urls).not.toContain(`${SITE_URL}/games/${insiderSlug}`);
      expect(urls.some((u) => u.includes(`/games/${insiderSlug}`))).toBe(false);
    }
  });
});
