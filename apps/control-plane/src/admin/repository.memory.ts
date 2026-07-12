import { randomUUID } from 'node:crypto';
import {
  type AdminAccount,
  type AdminRepository,
  DuplicateAdminError,
  type NewAdmin,
} from './repository';

/** In-memory admin store for tests - mirrors the Postgres uniqueness rule on email_normalized. */
export class InMemoryAdminRepository implements AdminRepository {
  private readonly admins = new Map<string, AdminAccount>();

  async create(admin: NewAdmin): Promise<AdminAccount> {
    for (const existing of this.admins.values()) {
      if (existing.emailNormalized === admin.emailNormalized) {
        throw new DuplicateAdminError();
      }
    }
    const now = new Date();
    const row: AdminAccount = {
      id: randomUUID(),
      email: admin.email,
      emailNormalized: admin.emailNormalized,
      passwordHash: admin.passwordHash,
      createdBy: admin.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.admins.set(row.id, row);
    return row;
  }

  async findByEmailNormalized(normalized: string): Promise<AdminAccount | null> {
    for (const admin of this.admins.values()) {
      if (admin.emailNormalized === normalized) return admin;
    }
    return null;
  }

  async findById(id: string): Promise<AdminAccount | null> {
    return this.admins.get(id) ?? null;
  }

  async list(): Promise<AdminAccount[]> {
    return [...this.admins.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateCredentials(
    id: string,
    email: string,
    passwordHash: string,
  ): Promise<AdminAccount | null> {
    const admin = this.admins.get(id);
    if (!admin) return null;
    const updated: AdminAccount = { ...admin, email, passwordHash, updatedAt: new Date() };
    this.admins.set(id, updated);
    return updated;
  }
}
