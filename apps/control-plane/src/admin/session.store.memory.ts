import { type AdminSession, type AdminSessionStore, newAdminSessionId } from './session';

/** In-memory admin session store for tests, with a deterministic clock for sliding-expiry tests. */
export class InMemoryAdminSessionStore implements AdminSessionStore {
  private readonly sessions = new Map<string, { session: AdminSession; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  async create(adminId: string): Promise<AdminSession> {
    const session: AdminSession = { id: newAdminSessionId(), adminId, createdAt: this.now() };
    this.sessions.set(session.id, { session, expiresAt: this.now() + this.ttlMs });
    return session;
  }

  async read(id: string): Promise<AdminSession | null> {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.sessions.delete(id);
      return null;
    }
    entry.expiresAt = this.now() + this.ttlMs;
    return entry.session;
  }

  async revoke(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
