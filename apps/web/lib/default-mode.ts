// Pick the initial play mode for a device joining a room (spec 0050), a sensible default the player
// can always override. Pure function of its inputs so it is unit-testable; callers pass the device's
// remembered mode, the room's current makeup, whether this is a rejoin, and `navigator.userAgent`.

import type { Mode } from './room-api';

// Phones and tablets default to the controller only (remote); everything else (desktop, TV, console)
// defaults to interactive.
const MOBILE_RE = /Mobi|Android|iPhone|iPad/;

// Markers of a TV / big-screen / console browser (smart-TV platforms, casting sticks, consoles).
// Some carry "Android" in their UA (Fire TV, Android TV), so they are excluded from the mobile check
// below - a big screen is a natural interactive display, not a phone-style controller.
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

/** True for a phone/tablet user agent (not a TV/console) - these default to `remote` (controller). */
export function isMobileUserAgent(userAgent: string): boolean {
  const ua = userAgent ?? '';
  if (TV_MARKERS.some((marker) => ua.includes(marker))) return false;
  return MOBILE_RE.test(ua);
}

/** The inputs that decide a device's default mode, in the priority order below. */
export interface DefaultModeContext {
  /** The mode this device last chose anywhere (localStorage), or null/undefined if none. */
  previous?: Mode | null;
  /** Whether the room already has an interactive member - i.e. a screen is already covered. */
  hasInteractive: boolean;
  /** Whether this device/session is already in the room (a second join / extra tab). */
  rejoining: boolean;
  /** navigator.userAgent, for the mobile check. */
  userAgent: string;
}

/**
 * The device-aware default mode, in priority order (spec 0050):
 * 1. Whatever this device previously used (localStorage), if any.
 * 2. Else if the room has NO interactive member yet -> `interactive` (be the shared screen).
 * 3. Else if this is a second join from this device -> `viewer`.
 * 4. Else if this is a mobile device -> `remote` (controller only).
 * 5. Otherwise -> `interactive`.
 * Always overridable by the player; this is only the initial pick.
 */
export function defaultMode(ctx: DefaultModeContext): Mode {
  if (ctx.previous === 'viewer' || ctx.previous === 'interactive' || ctx.previous === 'remote') {
    return ctx.previous;
  }
  if (!ctx.hasInteractive) return 'interactive';
  if (ctx.rejoining) return 'viewer';
  if (isMobileUserAgent(ctx.userAgent)) return 'remote';
  return 'interactive';
}
