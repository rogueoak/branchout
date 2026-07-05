import type { MembershipStore, RoomMember } from './membership';

/**
 * In-memory membership store for tests. Mirrors the Redis store's behaviour: members keyed by
 * session id per room, and a per-room set of kicked sessions that bars a rejoin.
 */
export class InMemoryMembershipStore implements MembershipStore {
  private readonly members = new Map<string, Map<string, RoomMember>>();
  private readonly kicked = new Map<string, Set<string>>();

  private roomMembers(roomId: string): Map<string, RoomMember> {
    let room = this.members.get(roomId);
    if (!room) {
      room = new Map();
      this.members.set(roomId, room);
    }
    return room;
  }

  async put(roomId: string, member: RoomMember): Promise<void> {
    this.roomMembers(roomId).set(member.sessionId, { ...member });
  }

  async get(roomId: string, sessionId: string): Promise<RoomMember | null> {
    const member = this.members.get(roomId)?.get(sessionId);
    return member ? { ...member } : null;
  }

  async list(roomId: string): Promise<RoomMember[]> {
    return [...(this.members.get(roomId)?.values() ?? [])].map((member) => ({ ...member }));
  }

  async remove(roomId: string, sessionId: string): Promise<void> {
    this.members.get(roomId)?.delete(sessionId);
  }

  async kick(roomId: string, sessionId: string): Promise<void> {
    this.members.get(roomId)?.delete(sessionId);
    let set = this.kicked.get(roomId);
    if (!set) {
      set = new Set();
      this.kicked.set(roomId, set);
    }
    set.add(sessionId);
  }

  async isKicked(roomId: string, sessionId: string): Promise<boolean> {
    return this.kicked.get(roomId)?.has(sessionId) ?? false;
  }

  async clear(roomId: string): Promise<void> {
    this.members.delete(roomId);
    this.kicked.delete(roomId);
  }
}
