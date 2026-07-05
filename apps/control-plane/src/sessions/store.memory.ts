import type { Session } from './session';
import { type CreateSessionInput, newSessionId, type SessionStore } from './store';

/**
 * In-memory session store for tests. Models the sliding TTL with a numeric clock so expiry is
 * deterministic: pass `now()` to control time, and `advance` the clock in a test to lapse a
 * session without waiting.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, { session: Session; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: newSessionId(),
      kind: input.kind,
      displayName: input.displayName,
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.roomCode !== undefined ? { roomCode: input.roomCode } : {}),
      createdAt: this.now(),
    };
    this.sessions.set(session.id, { session, expiresAt: this.now() + this.ttlMs });
    return session;
  }

  async read(id: string): Promise<Session | null> {
    const entry = this.sessions.get(id);
    if (!entry) {
      return null;
    }
    if (this.now() >= entry.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    // Sliding expiry: refresh the deadline on use.
    entry.expiresAt = this.now() + this.ttlMs;
    return entry.session;
  }

  async revoke(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
