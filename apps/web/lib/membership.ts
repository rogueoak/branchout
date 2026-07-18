// The caller's own place in a room, carried across the create/join step and the room page. Join
// now returns the caller's public `playerId` (spec 0012) and the host reads its own from the
// members list, so this remembers that identity plus the role/mode/nickname chosen at join. This is
// per-tab session storage, not a source of truth: the server re-authorizes every action from the
// session cookie regardless.

import type { Mode, RoomView } from './room-api';

/** What the browser remembers about the current member between the join step and the room page. */
export interface Membership {
  /** True when this browser created the room and holds the host powers (controls, kick). */
  isHost?: boolean;
  /** This device's mode (spec 0050): viewer, interactive, or remote. */
  mode: Mode;
  nickname: string;
  /**
   * This device's public engine `playerId` (the identity the engine roster and `join` key on, NOT
   * the httpOnly session id). A non-host player gets it from the join response; the host reads its
   * own from the members list (its host row), so it may be absent until that list first loads.
   */
  player?: string;
  room: RoomView;
}

function key(code: string): string {
  return `branchout:membership:${code.toUpperCase()}`;
}

export function rememberMembership(code: string, membership: Membership): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key(code), JSON.stringify(membership));
}

export function recallMembership(code: string): Membership | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(key(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Membership;
  } catch {
    return null;
  }
}

export function forgetMembership(code: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(key(code));
}

// This device's last chosen mode (spec 0050), remembered across rooms in localStorage so the mode
// picker can default to what the device used before (the first rule of `defaultMode`). Device-level,
// not per-room: it is a preference of this screen/controller, not of any one game.
const DEVICE_MODE_KEY = 'branchout:deviceMode';

/** Remember the mode this device just chose, so the next room defaults to it. */
export function rememberDeviceMode(mode: Mode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEVICE_MODE_KEY, mode);
}

/** The mode this device last chose, or null if it has never chosen one (or storage is unavailable). */
export function recallDeviceMode(): Mode | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(DEVICE_MODE_KEY);
  return raw === 'viewer' || raw === 'interactive' || raw === 'remote' ? raw : null;
}

// The last name this player *picked* on /join (spec 0066), remembered across rooms in localStorage so
// the join form can pre-fill it next time - even for an anonymous player with no account. A
// cross-visit convenience, so it lives in localStorage like the device mode, not the per-tab
// sessionStorage seat state.
//
// This is deliberately separate from the generated anonymous default (below): a name the player
// actually typed wins for everyone, but the auto-generated fallback must NEVER be written here, or a
// browser that later signs in would see the stale generated name shadow its authoritative gamer tag.
const PLAYER_NAME_KEY = 'branchout:playerName';

/** Remember the name this player actually typed, so the next /join defaults to it. Blank is ignored. */
export function rememberPlayerName(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed === '') return;
  window.localStorage.setItem(PLAYER_NAME_KEY, trimmed);
}

/** The name this player last picked, or null if none was remembered (or storage is unavailable). */
export function recallPlayerName(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(PLAYER_NAME_KEY);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

// The generated anonymous default (spec 0066), kept under a DISTINCT key from the picked name so it
// can never shadow a signed-in gamer tag. Minted at most once per browser for an anonymous player
// with no picked name and no gamer tag, then reused so the same fun name sticks across visits. If
// that browser later signs in, precedence falls back to the gamer tag - this stays a fallback only.
const ANON_NAME_KEY = 'branchout:anonName';

/** Remember the generated anonymous default, so a fresh anonymous joiner keeps the same fun name. */
export function rememberAnonName(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed === '') return;
  window.localStorage.setItem(ANON_NAME_KEY, trimmed);
}

/** The generated anonymous default this browser minted, or null if none (or storage is unavailable). */
export function recallAnonName(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ANON_NAME_KEY);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
