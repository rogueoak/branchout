import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

describe('loadConfig cookie policy', () => {
  it('defaults to a safe cookie: secure + sameSite lax', () => {
    const config = loadConfig({ ...base });
    expect(config.cookie.secure).toBe(true);
    expect(config.cookie.sameSite).toBe('lax');
    expect(config.cookie.name).toBe('branchout_session');
  });

  it('relaxes secure only when told to, for local http', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false' }).cookie.secure).toBe(false);
    expect(loadConfig({ ...base, COOKIE_SECURE: '1' }).cookie.secure).toBe(true);
  });

  it('accepts a valid sameSite override and ignores an invalid one', () => {
    expect(loadConfig({ ...base, COOKIE_SAMESITE: 'none' }).cookie.sameSite).toBe('none');
    expect(loadConfig({ ...base, COOKIE_SAMESITE: 'strict' }).cookie.sameSite).toBe('strict');
    expect(loadConfig({ ...base, COOKIE_SAMESITE: 'bogus' }).cookie.sameSite).toBe('lax');
  });

  it('parses a comma-separated web origin allowlist', () => {
    const config = loadConfig({
      ...base,
      WEB_ORIGIN: 'https://a.example, https://b.example',
    });
    expect(config.webOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});
