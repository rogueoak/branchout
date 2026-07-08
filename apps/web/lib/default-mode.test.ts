import { describe, expect, it } from 'vitest';
import { defaultMode } from './default-mode';

// A few real-ish user agents for the three device classes we default from.
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
const CHROMECAST_UA =
  'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0 Safari/537.36 CrKey/1.56.500000';

describe('defaultMode', () => {
  it('defaults a mobile device to remote', () => {
    expect(defaultMode(MOBILE_UA)).toBe('remote');
    expect(defaultMode(ANDROID_UA)).toBe('remote');
  });

  it('defaults a detectable TV / console browser to interactive', () => {
    expect(defaultMode(TIZEN_TV_UA)).toBe('interactive');
    expect(defaultMode(CHROMECAST_UA)).toBe('interactive');
  });

  it('prefers the TV signal over the mobile one (a Fire TV on Android is interactive)', () => {
    // Fire TV UAs carry "Android" but should be treated as a big screen, not a phone.
    expect(defaultMode(FIRE_TV_UA)).toBe('interactive');
  });

  it('defaults a desktop browser to interactive', () => {
    expect(defaultMode(DESKTOP_UA)).toBe('interactive');
  });

  it('falls back to interactive for an empty or unknown user agent', () => {
    expect(defaultMode('')).toBe('interactive');
  });
});
