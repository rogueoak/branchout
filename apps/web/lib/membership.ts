// The caller's own place in a room, carried across the create/join step and the room page. The
// control-plane does not yet expose a "who am I in this room" read (a GET room, or the caller's
// member id on join - see docs/feedback/0010-web-client-integration-gaps.md), so the browser
// remembers what it chose at join time. This is per-tab session storage, not a source of truth:
// the server re-authorizes every action from the session cookie regardless.

import type { Mode, Role, RoomView } from './room-api';

/** What the browser remembers about the current player between the join step and the room page. */
export interface Membership {
  role: Role;
  mode?: Mode;
  nickname: string;
  /**
   * This device's engine player id (the control-plane session id used in the start handoff). The
   * host can read it from the members list (their own host row); a non-host player cannot yet, so
   * it may be absent until the control-plane returns it on join.
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
