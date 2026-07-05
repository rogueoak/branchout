import type { MembershipStore, RoomMember } from './membership';

/**
 * The narrow Redis surface the membership store needs. Keeps the store decoupled from the full
 * client type and trivially fakeable, the same pattern the session store uses. A room's members
 * live in a hash (`room:<id>:members`, field = session id) and its kicked sessions in a set
 * (`room:<id>:kicked`).
 */
export interface MembershipRedis {
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | null | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, field: string): Promise<unknown>;
  sAdd(key: string, member: string): Promise<unknown>;
  sIsMember(key: string, member: string): Promise<boolean>;
  del(key: string | string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const MEMBERS = (roomId: string): string => `room:${roomId}:members`;
const KICKED = (roomId: string): string => `room:${roomId}:kicked`;

/**
 * Redis-backed membership store. Ephemeral by design: every write refreshes a TTL so an abandoned
 * room's live state lapses on its own rather than leaking forever (the durable room record in
 * Postgres is the system of record). `clear` drops it immediately when a room closes.
 */
export class RedisMembershipStore implements MembershipStore {
  constructor(
    private readonly redis: MembershipRedis,
    /** TTL in seconds, refreshed on every write, after which idle live state lapses. */
    private readonly ttlSeconds: number,
  ) {}

  private async touch(roomId: string): Promise<void> {
    await Promise.all([
      this.redis.expire(MEMBERS(roomId), this.ttlSeconds),
      this.redis.expire(KICKED(roomId), this.ttlSeconds),
    ]);
  }

  async put(roomId: string, member: RoomMember): Promise<void> {
    await this.redis.hSet(MEMBERS(roomId), member.sessionId, JSON.stringify(member));
    await this.touch(roomId);
  }

  async get(roomId: string, sessionId: string): Promise<RoomMember | null> {
    const raw = await this.redis.hGet(MEMBERS(roomId), sessionId);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as RoomMember;
    } catch {
      return null;
    }
  }

  async list(roomId: string): Promise<RoomMember[]> {
    const all = await this.redis.hGetAll(MEMBERS(roomId));
    const members: RoomMember[] = [];
    for (const raw of Object.values(all ?? {})) {
      try {
        members.push(JSON.parse(raw) as RoomMember);
      } catch {
        // Skip a corrupt entry rather than failing the whole listing.
      }
    }
    return members;
  }

  async remove(roomId: string, sessionId: string): Promise<void> {
    await this.redis.hDel(MEMBERS(roomId), sessionId);
  }

  async kick(roomId: string, sessionId: string): Promise<void> {
    await this.redis.hDel(MEMBERS(roomId), sessionId);
    await this.redis.sAdd(KICKED(roomId), sessionId);
    await this.touch(roomId);
  }

  async isKicked(roomId: string, sessionId: string): Promise<boolean> {
    return this.redis.sIsMember(KICKED(roomId), sessionId);
  }

  async clear(roomId: string): Promise<void> {
    await this.redis.del([MEMBERS(roomId), KICKED(roomId)]);
  }
}
