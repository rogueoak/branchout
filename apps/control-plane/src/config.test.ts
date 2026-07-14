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

describe('loadConfig feedback (spec 0048)', () => {
  it('leaves the Resend key unset and uses the default per-IP cap when no env is given', () => {
    const { feedback } = loadConfig({ ...base });
    // Unset key -> the "not configured" state; the object must not carry `resendApiKey: undefined`.
    expect('resendApiKey' in feedback).toBe(false);
    expect(feedback.maxPerIp).toBe(5);
    expect(feedback.windowSeconds).toBe(600);
  });

  it('reads the key and tunable per-IP thresholds from the environment', () => {
    const { feedback } = loadConfig({
      ...base,
      RESEND_API_KEY: 're_live_key',
      FEEDBACK_MAX_PER_IP: '3',
      FEEDBACK_WINDOW_SECONDS: '900',
    });
    expect(feedback.resendApiKey).toBe('re_live_key');
    expect(feedback.maxPerIp).toBe(3);
    expect(feedback.windowSeconds).toBe(900);
  });

  it('falls back to the default on a garbage cap (a NaN cap would fail open)', () => {
    const { feedback } = loadConfig({ ...base, FEEDBACK_MAX_PER_IP: 'abc' });
    expect(feedback.maxPerIp).toBe(5);
  });
});

describe('loadConfig subscribe / Constant Contact (spec 0047)', () => {
  it('leaves the CTCT credentials unset by default (the endpoint ships inert)', () => {
    const { subscribe } = loadConfig({ ...base });
    expect('ctctClientId' in subscribe).toBe(false);
    expect('ctctRefreshToken' in subscribe).toBe(false);
    expect('ctctListId' in subscribe).toBe(false);
    // The per-IP knobs default to 5 / 10 min.
    expect(subscribe.maxPerIp).toBe(5);
    expect(subscribe.windowSeconds).toBe(600);
  });

  it('reads the CTCT credentials and the tunable rate-limit knobs from the environment', () => {
    const { subscribe } = loadConfig({
      ...base,
      CTCT_CLIENT_ID: 'client-1',
      CTCT_REFRESH_TOKEN: 'refresh-1',
      CTCT_LIST_ID: 'list-branch-out',
      SUBSCRIBE_MAX_PER_IP: '9',
      SUBSCRIBE_WINDOW_SECONDS: '120',
    });
    expect(subscribe).toEqual({
      ctctClientId: 'client-1',
      ctctRefreshToken: 'refresh-1',
      ctctListId: 'list-branch-out',
      maxPerIp: 9,
      windowSeconds: 120,
    });
  });

  it('falls back to the default on a garbage subscribe knob', () => {
    const { subscribe } = loadConfig({ ...base, SUBSCRIBE_MAX_PER_IP: 'abc' });
    expect(subscribe.maxPerIp).toBe(5);
  });
});
