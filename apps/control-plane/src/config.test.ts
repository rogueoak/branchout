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

  it('leaves the cookie host-only by default, and scopes to a parent domain when set (spec 0035)', () => {
    // Unset -> no domain key at all (host-only), never `domain: undefined`.
    expect('domain' in loadConfig({ ...base }).cookie).toBe(false);
    expect(loadConfig({ ...base, COOKIE_DOMAIN: '.branchout.games' }).cookie.domain).toBe(
      '.branchout.games',
    );
  });

  it('parses a comma-separated web origin allowlist', () => {
    const config = loadConfig({
      ...base,
      WEB_ORIGIN: 'https://a.example, https://b.example',
    });
    expect(config.webOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('loadConfig rate limiting (spec 0036)', () => {
  it('defaults to sane auth thresholds', () => {
    const { rateLimit } = loadConfig({ ...base });
    expect(rateLimit).toEqual({
      loginMaxAttempts: 5,
      loginWindowSeconds: 900,
      signupMaxPerIp: 10,
      signupWindowSeconds: 3600,
    });
  });

  it('reads the thresholds from the environment', () => {
    const { rateLimit } = loadConfig({
      ...base,
      LOGIN_MAX_ATTEMPTS: '3',
      LOGIN_WINDOW_SECONDS: '60',
      SIGNUP_MAX_PER_IP: '2',
      SIGNUP_WINDOW_SECONDS: '120',
    });
    expect(rateLimit).toEqual({
      loginMaxAttempts: 3,
      loginWindowSeconds: 60,
      signupMaxPerIp: 2,
      signupWindowSeconds: 120,
    });
  });

  it('falls back to the default on a garbage threshold (a NaN limit would lock everyone out)', () => {
    const { rateLimit } = loadConfig({
      ...base,
      LOGIN_MAX_ATTEMPTS: 'abc',
      SIGNUP_MAX_PER_IP: '0',
      LOGIN_WINDOW_SECONDS: '-5',
    });
    expect(rateLimit.loginMaxAttempts).toBe(5); // not NaN
    expect(rateLimit.signupMaxPerIp).toBe(10); // zero rejected
    expect(rateLimit.loginWindowSeconds).toBe(900); // negative rejected
  });
});
