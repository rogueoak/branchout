import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../lib/site';
import robots from './robots';

describe('robots', () => {
  it('points crawlers at the sitemap and disallows the private/dynamic surfaces', () => {
    const result = robots();
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.allow).toBe('/');
    expect(rules?.disallow).toEqual(expect.arrayContaining(['/account', '/rooms/', '/join']));
  });
});
