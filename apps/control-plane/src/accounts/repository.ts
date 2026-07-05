import type { Pool } from 'pg';

/** An account as stored. The password hash never leaves the repository layer casually - see
 * `AccountService`, which returns `PublicAccount` to callers. */
export interface Account {
  id: string;
  email: string;
  passwordHash: string;
  gamerTag: string;
  gamerTagNormalized: string;
  nickname: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The shape used to create a new account row. */
export interface NewAccount {
  email: string;
  passwordHash: string;
  gamerTag: string;
  gamerTagNormalized: string;
  nickname: string;
}

/**
 * Persistence for accounts. Behind an interface so the service is testable without a live
 * Postgres: `InMemoryAccountRepository` backs the unit tests, `PostgresAccountRepository`
 * runs in production.
 */
export interface AccountRepository {
  create(account: NewAccount): Promise<Account>;
  findByEmail(normalizedEmail: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  findByGamerTagNormalized(normalized: string): Promise<Account | null>;
  updateNickname(id: string, nickname: string): Promise<Account | null>;
}

/** Raised when a unique constraint (email or gamer tag) is violated at the database. */
export class DuplicateAccountError extends Error {
  constructor(public field: 'email' | 'gamerTag') {
    super(`account ${field} already exists`);
    this.name = 'DuplicateAccountError';
  }
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  gamer_tag: string;
  gamer_tag_normalized: string;
  nickname: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    gamerTag: row.gamer_tag,
    gamerTagNormalized: row.gamer_tag_normalized,
    nickname: row.nickname,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Postgres unique-violation error code.
const PG_UNIQUE_VIOLATION = '23505';

/** Postgres-backed account store. All queries are parameterized - never string-built. */
export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async create(account: NewAccount): Promise<Account> {
    try {
      const result = await this.pool.query<AccountRow>(
        `INSERT INTO accounts (email, password_hash, gamer_tag, gamer_tag_normalized, nickname)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          account.email,
          account.passwordHash,
          account.gamerTag,
          account.gamerTagNormalized,
          account.nickname,
        ],
      );
      // A RETURNING insert always yields exactly one row.
      return mapRow(result.rows[0]!);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint ?? '';
      if (code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateAccountError(constraint.includes('gamer_tag') ? 'gamerTag' : 'email');
      }
      throw error;
    }
  }

  async findByEmail(normalizedEmail: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE email = $1', [
      normalizedEmail,
    ]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByGamerTagNormalized(normalized: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      'SELECT * FROM accounts WHERE gamer_tag_normalized = $1',
      [normalized],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async updateNickname(id: string, nickname: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `UPDATE accounts SET nickname = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, nickname],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }
}
