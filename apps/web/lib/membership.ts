// The caller's own place in a room, carried across the create/join step and the room page. Join
// now returns the caller's public `playerId` (spec 0012) and the host reads its own from the
// members list, so this remembers that identity plus the role/mode/nickname chosen at join. This is
// per-tab session storage, not a source of truth: the server re-authorizes every action from the
// session cookie regardless.

import type { Mode, Role, RoomView } from './room-api';

/** What the browser remembers about the current player between the join step and the room page. */
export interface Membership {
  role: Role;
  mode?: Mode;
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
