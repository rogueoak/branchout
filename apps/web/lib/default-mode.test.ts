import { describe, expect, it } from 'vitest';
import { defaultMode, isMobileUserAgent } from './default-mode';

// A few real-ish user agents for the device classes we default from.
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIZEN_TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146 SamsungBrowser/2.3 SmartTV Safari/537.36';
const FIRE_TV_UA =
  'Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0 Safari/537.36';

// A base context: fresh device (no remembered mode), a screen already present, a first join. Each
// test overrides just the field it exercises so the precedence order is clear.
const base = { previous: null, hasInteractive: true, rejoining: false, userAgent: DESKTOP_UA };

describe('isMobileUserAgent', () => {
  it('is true for phones and tablets', () => {
    expect(isMobileUserAgent(MOBILE_UA)).toBe(true);
    expect(isMobileUserAgent(ANDROID_UA)).toBe(true);
  });

  it('is false for desktop and for TV/console browsers (even Android-based ones)', () => {
    expect(isMobileUserAgent(DESKTOP_UA)).toBe(false);
    expect(isMobileUserAgent(TIZEN_TV_UA)).toBe(false);
    expect(isMobileUserAgent(FIRE_TV_UA)).toBe(false); // Android UA, but a Fire TV is a big screen
    expect(isMobileUserAgent('')).toBe(false);
  });
});

describe('defaultMode (spec 0050 precedence)', () => {
  it('1. uses the device remembered mode above all else', () => {
    expect(defaultMode({ ...base, previous: 'viewer' })).toBe('viewer');
    // Remembered wins even on a mobile device and an empty-screen room.
    expect(
      defaultMode({
        previous: 'remote',
        hasInteractive: false,
        rejoining: true,
        userAgent: MOBILE_UA,
      }),
    ).toBe('remote');
  });

  it('2. with no remembered mode and no interactive member yet, defaults to interactive', () => {
    expect(defaultMode({ ...base, hasInteractive: false, userAgent: MOBILE_UA })).toBe(
      'interactive',
    );
  });

  it('3. a second join from this device defaults to viewer', () => {
    expect(defaultMode({ ...base, rejoining: true })).toBe('viewer');
  });

  it('4. a mobile device (first join, screen present) defaults to remote', () => {
    expect(defaultMode({ ...base, userAgent: MOBILE_UA })).toBe('remote');
  });

  it('5. otherwise defaults to interactive (desktop / TV)', () => {
    expect(defaultMode({ ...base, userAgent: DESKTOP_UA })).toBe('interactive');
    expect(defaultMode({ ...base, userAgent: TIZEN_TV_UA })).toBe('interactive');
    expect(defaultMode({ ...base, userAgent: FIRE_TV_UA })).toBe('interactive');
  });
});
