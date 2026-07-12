import type { Pool } from 'pg';

/** An admin account as stored. A SEPARATE identity from player `accounts` (spec 0037). The password
 * hash never leaves the repository layer casually - `AdminService` returns `PublicAdmin` to callers. */
export interface AdminAccount {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  /** The admin who created this one; null for the env-seeded root admin. */
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The shape used to create a new admin row. */
export interface NewAdmin {
  email: string;
  emailNormalized: string;
  passwordHash: string;
  createdBy: string | null;
}

/**
 * Persistence for admin accounts. Behind an interface so the service is testable without a live
 * Postgres: `InMemoryAdminRepository` backs the unit tests, `PostgresAdminRepository` runs in prod.
 */
export interface AdminRepository {
  create(admin: NewAdmin): Promise<AdminAccount>;
  findByEmailNormalized(normalized: string): Promise<AdminAccount | null>;
  findById(id: string): Promise<AdminAccount | null>;
  /** All admins, newest first - for the console's admin list. */
  list(): Promise<AdminAccount[]>;
  /** Refresh an existing admin's display email + password (the root reconcile on boot, so a casing or
   * spelling change to ADMIN_ROOT_EMAIL that keeps the same normalized value is not left stale). */
  updateCredentials(id: string, email: string, passwordHash: string): Promise<AdminAccount | null>;
}

/** Raised when the unique admin email is violated at the database. */
export class DuplicateAdminError extends Error {
  constructor() {
    super('admin email already exists');
    this.name = 'DuplicateAdminError';
  }
}

interface AdminRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: AdminRow): AdminAccount {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    passwordHash: row.password_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PG_UNIQUE_VIOLATION = '23505';

/** Postgres-backed admin store. All queries are parameterized - never string-built. */
export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly pool: Pool) {}

  async create(admin: NewAdmin): Promise<AdminAccount> {
    try {
      const result = await this.pool.query<AdminRow>(
        `INSERT INTO admin_accounts (email, email_normalized, password_hash, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [admin.email, admin.emailNormalized, admin.passwordHash, admin.createdBy],
      );
      return mapRow(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateAdminError();
      }
      throw error;
    }
  }

  async findByEmailNormalized(normalized: string): Promise<AdminAccount | null> {
    const result = await this.pool.query<AdminRow>(
      'SELECT * FROM admin_accounts WHERE email_normalized = $1',
      [normalized],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<AdminAccount | null> {
    const result = await this.pool.query<AdminRow>('SELECT * FROM admin_accounts WHERE id = $1', [
      id,
    ]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async list(): Promise<AdminAccount[]> {
    const result = await this.pool.query<AdminRow>(
      'SELECT * FROM admin_accounts ORDER BY created_at DESC',
    );
    return result.rows.map(mapRow);
  }

  async updateCredentials(
    id: string,
    email: string,
    passwordHash: string,
  ): Promise<AdminAccount | null> {
    const result = await this.pool.query<AdminRow>(
      `UPDATE admin_accounts SET email = $2, password_hash = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, email, passwordHash],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }
}
