/**
 * Live room membership, presence, and mode live in Redis (ephemeral, high-churn), keyed by room.
 * The durable facts - the room exists, who hosts it, game history - live in Postgres. This module
 * is the Redis half: who is in the room, whether they are connected, each player's mode, and each
 * member's per-game nickname.
 */

import { randomBytes } from 'node:crypto';

/**
 * Mint a member's public `playerId`: an unguessable, url-safe token (128 bits), distinct from the
 * session id. It is safe to hand to the browser (it grants nothing on its own), so it can be the
 * engine roster/`join` identity a non-host device reads back, while `sessionId` stays host-only.
 */
export function newPlayerId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * A member's mode (spec 0050). Every member has exactly one:
 * - `viewer`: watches only (a shared screen); never plays, and never counts toward a game's player
 *   limits or paid rounds. Replaces the old `observer` role.
 * - `interactive`: plays AND shows the game on this device (screen + controller together).
 * - `remote`: plays with a controller only; needs another device to show the game.
 * `interactive` and `remote` are the PLAYING modes (they fill the roster and count toward limits);
 * `viewer` and `interactive` are the DISPLAY modes (a device that can show the game on a screen).
 */
export type Mode = 'viewer' | 'interactive' | 'remote';

/**
 * One member of a room. Keyed by the joining session id (account or anonymous), so a kick can
 * block that exact session from rejoining while the code still works for everyone else. The
 * `nickname` is the per-game display name chosen at join - an account may override its default
 * here, an anonymous player just picks one.
 */
export interface RoomMember {
  sessionId: string;
  /**
   * A stable, public, NON-sensitive identity for this member within the room, minted on join and
   * distinct from `sessionId`. This is the identity the engine roster and `join` key on, and the
   * only one safe to hand to the browser: unlike `sessionId` (the httpOnly cookie value, the kick /
   * rejoin key) it grants nothing, and it is already broadcast to every device inside the engine
   * `state` frame's `players[].player`. Echo `playerId` to JS; never echo `sessionId`.
   */
  playerId: string;
  /** The durable account id when the member signed in; absent for an anonymous member. */
  accountId?: string;
  /**
   * True for the room's host - the person who created it. The host has a mode like everyone else,
   * and this flag additionally carries the admin powers: game controls, kick, and seeing other
   * members' `sessionId`. The host is never kickable.
   */
  isHost: boolean;
  /** This member's mode (spec 0050): `viewer`, `interactive`, or `remote`. Always set. */
  mode: Mode;
  /** Per-game display name chosen at join. */
  nickname: string;
  /** Presence: whether the member's device is currently connected. */
  connected: boolean;
  /**
   * This member's reserved drawing palette id (spec 0063, Sketchy palettes). Assigned a random still-
   * available palette on join (server-side default) and changeable to any other free one; reserved
   * best-effort so members almost never share a palette (a taken one is refused; only two truly
   * simultaneous claims over the non-transactional store could briefly collide). Threaded to the engine at start so a
   * game (Sketchy) validates the member's strokes against only their palette. Optional: rooms
   * predating the field, or the astronomically rare case of every palette being taken by other
   * members, leave it absent.
   */
  paletteId?: string;
}

/**
 * A DISPLAY member can show the game on a screen: a `viewer` (a shared screen) or an `interactive`
 * player. A game needs at least one to start - a room of only `remote` players has no screen.
 */
export function isDisplay(member: RoomMember): boolean {
  return member.mode === 'viewer' || member.mode === 'interactive';
}

/** True if at least one member can display the game - the "at least one screen" start rule. */
export function hasDisplay(members: readonly RoomMember[]): boolean {
  return members.some(isDisplay);
}

/**
 * A PLAYING member takes part in the game (`interactive` or `remote`); a `viewer` does not. Only
 * playing members count toward a game's player limits, fill the engine roster, and count toward
 * paid rounds (spec 0050).
 */
export function isPlaying(member: RoomMember): boolean {
  return member.mode === 'interactive' || member.mode === 'remote';
}

/** How many members are playing (interactive + remote) - the count a game's limits bound. */
export function playingCount(members: readonly RoomMember[]): number {
  return members.reduce((n, m) => (isPlaying(m) ? n + 1 : n), 0);
}

/**
 * Redis-backed membership store. Membership and presence are ephemeral, so they live here rather
 * than Postgres. Behind an interface so the room service is testable without a live Redis:
 * `InMemoryMembershipStore` backs unit tests, `RedisMembershipStore` runs in production.
 */
export interface MembershipStore {
  /** Add or replace a member of a room, keyed by their session id. */
  put(roomId: string, member: RoomMember): Promise<void>;
  /** Fetch one member by session id, or null if they are not in the room. */
  get(roomId: string, sessionId: string): Promise<RoomMember | null>;
  /** Every current member of the room. */
  list(roomId: string): Promise<RoomMember[]>;
  /** Remove a member (leave). Does not block a rejoin - that is `kick`. */
  remove(roomId: string, sessionId: string): Promise<void>;
  /**
   * Kick a member: remove them and block a rejoin with the same session id. The room code still
   * works for anyone else; only this session is barred.
   */
  kick(roomId: string, sessionId: string): Promise<void>;
  /** True if the session was kicked from this room and may not rejoin. */
  isKicked(roomId: string, sessionId: string): Promise<boolean>;
  /** Drop all membership and kick state for a room (room closed). */
  clear(roomId: string): Promise<void>;
}
