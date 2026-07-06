/**
 * Live room membership, presence, and mode live in Redis (ephemeral, high-churn), keyed by room.
 * The durable facts - the room exists, who hosts it, game history - live in Postgres. This module
 * is the Redis half: who is in the room, whether they are connected, each player's mode, and each
 * member's per-game nickname.
 */

/** A member's role in a room. The host owns it; players play; observers only watch. */
export type Role = 'host' | 'player' | 'observer';

/** A player's chosen mode. `interactive` is a viewer + remote on one screen; `remote` is a
 * controller only. Observers have no mode (they only watch). */
export type Mode = 'interactive' | 'remote';

/**
 * One member of a room. Keyed by the joining session id (account or anonymous), so a kick can
 * block that exact session from rejoining while the code still works for everyone else. The
 * `nickname` is the per-game display name chosen at join - an account may override its default
 * here, an anonymous player just picks one.
 */
export interface RoomMember {
  sessionId: string;
  /** The durable account id when the member signed in; absent for an anonymous member. */
  accountId?: string;
  role: Role;
  /** Set for a player; absent for host and observers. */
  mode?: Mode;
  /** Per-game display name chosen at join. */
  nickname: string;
  /** Presence: whether the member's device is currently connected. */
  connected: boolean;
}

/**
 * A viewer is what a game needs to start: an observer, or an interactive player (someone with a
 * screen to watch on). A room of only remote players has no viewer and cannot start.
 */
export function isViewer(member: RoomMember): boolean {
  return member.role === 'observer' || (member.role === 'player' && member.mode === 'interactive');
}

/** True if at least one member is a viewer - the "at least one viewer" start rule. */
export function hasViewer(members: readonly RoomMember[]): boolean {
  return members.some(isViewer);
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
