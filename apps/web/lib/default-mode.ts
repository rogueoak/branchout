// Pick a play mode from the device, so the mode picker starts on a sensible default the player can
// always override. Best-effort user-agent sniffing: a detectable TV browser wants the shared viewer
// (interactive), a phone or tablet wants the controller only (remote), and anything else falls back
// to interactive. Pure function of the UA string so it is unit-testable; callers pass
// `navigator.userAgent`.

import type { Mode } from './room-api';

// Substrings that mark a TV / big-screen / console browser: smart-TV platforms, casting sticks, and
// game consoles. These want the shared viewer on the big screen, so they default to interactive.
const TV_MARKERS = [
  'SmartTV',
  'Tizen',
  'Web0S',
  'webOS',
  'AFT', // Amazon Fire TV device models (AFTS, AFTM, ...)
  'GoogleTV',
  'AppleTV',
  'HbbTV',
  'NetCast',
  'BRAVIA',
  'CrKey', // Chromecast
  'PlayStation',
  'Xbox',
];

// Phones and tablets default to the controller only (remote).
const MOBILE_RE = /Mobi|Android|iPhone|iPad/;

/**
 * The device-aware default play mode. A detectable TV/console browser -> `interactive` (it is the
 * shared viewer); a mobile device -> `remote` (controller only); anything else -> `interactive`.
 * Always overridable by the player; this is only the initial pick.
 */
export function defaultMode(userAgent: string): Mode {
  const ua = userAgent ?? '';
  if (TV_MARKERS.some((marker) => ua.includes(marker))) {
    return 'interactive';
  }
  if (MOBILE_RE.test(ua)) {
    return 'remote';
  }
  return 'interactive';
}
