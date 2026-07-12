import type { Pool } from 'pg';

/**
 * Profile visibility (spec 0027). `public` shows the full profile; `private` shows only the
 * always-public gamer tag + stars; `friends-only` behaves as `private` to non-friends until the
 * friend graph ships (a later spec), so today it is effectively private to anyone but the owner.
 */
export type ProfileVisibility = 'public' | 'friends-only' | 'private';

/** The visibility values in one place, for validation and the picker. */
export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = [
  'public',
  'friends-only',
  'private',
];

/** An account as stored. The password hash never leaves the repository layer casually - see
 * `AccountService`, which returns `PublicAccount` to callers. */
export interface Account {
  id: string;
  email: string;
  passwordHash: string;
  gamerTag: string;
  gamerTagNormalized: string;
  nickname: string;
  /** The chosen avatar id (spec 0027); one of `@branchout/brand/avatar-ids`. */
  avatar: string;
  /** Who may see the full profile (spec 0027). */
  visibility: ProfileVisibility;
  /** Beta-tester entitlement (spec 0035): gates the insider surface. Granted out-of-band for now. */
  insider: boolean;
  emailVerified: boolean;
  /** When the account was soft-deleted (spec 0040); null while live. A soft-deleted account cannot
   * authenticate but stays visible in the admin console until an admin hard-deletes it. */
  deletedAt: Date | null;
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
  /** The deterministic default avatar the service seeds from the gamer tag. */
  avatar: string;
}

/**
 * Persistence for accounts. Behind an interface so the service is testable without a live
 * Postgres: `InMemoryAccountRepository` backs the unit tests, `PostgresAccountRepository`
 * runs in production.
 */
export interface AccountRepository {
  create(account: NewAccount): Promise<Account>;
  findByEmail(normalizedEmail: string): Promise<Account | null>;
  /**
   * Look up by id. Soft-deleted rows (spec 0040) are excluded by default so player/auth paths never
   * load a deleted account; pass `{ includeDeleted: true }` for the admin console, which must still
   * see them.
   */
  findById(id: string, opts?: { includeDeleted?: boolean }): Promise<Account | null>;
  findByGamerTagNormalized(normalized: string): Promise<Account | null>;
  updateNickname(id: string, nickname: string): Promise<Account | null>;
  updateAvatar(id: string, avatar: string): Promise<Account | null>;
  updateVisibility(id: string, visibility: ProfileVisibility): Promise<Account | null>;
  /** Grant or revoke the insider role (spec 0037 admin toggle). */
  updateInsider(id: string, insider: boolean): Promise<Account | null>;
  /**
   * Soft-delete (spec 0040): stamp `deleted_at` and free the unique-constrained identity columns
   * (email + normalized gamer tag) so the same email/tag can register again, keeping the display
   * gamer tag + nickname for the admin console. Returns the updated row, or null if not found.
   */
  softDelete(id: string): Promise<Account | null>;
  /** Hard-delete (spec 0040): remove the row outright. `account_game_plays` cascades; the credit
   * ledger is kept by design. Returns true if a row was deleted. */
  hardDelete(id: string): Promise<boolean>;
  /** Paginated player list for the admin console, optionally filtered by gamer tag (spec 0037).
   * Includes soft-deleted rows (spec 0040) so the console can flag them. */
  listAccounts(opts: ListAccountsOptions): Promise<AccountPage>;
}

/** Options for the admin player list: an optional gamer-tag substring, plus a page window. */
export interface ListAccountsOptions {
  /** A gamer-tag substring to match (normalized); empty/absent lists everyone. */
  query?: string;
  limit: number;
  offset: number;
}

/** One page of accounts plus the total match count, for the console's pagination. */
export interface AccountPage {
  items: Account[];
  total: number;
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
  avatar: string;
  profile_visibility: ProfileVisibility;
  insider: boolean;
  email_verified: boolean;
  deleted_at: Date | null;
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
    avatar: row.avatar,
    visibility: row.profile_visibility,
    insider: row.insider,
    emailVerified: row.email_verified,
    deletedAt: row.deleted_at,
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
        `INSERT INTO accounts (email, password_hash, gamer_tag, gamer_tag_normalized, nickname, avatar)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          account.email,
          account.passwordHash,
          account.gamerTag,
          account.gamerTagNormalized,
          account.nickname,
          account.avatar,
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

  async findById(id: string, opts?: { includeDeleted?: boolean }): Promise<Account | null> {
    // Player/auth reads exclude soft-deleted rows; the admin console passes includeDeleted (spec 0040).
    const sql = opts?.includeDeleted
      ? 'SELECT * FROM accounts WHERE id = $1'
      : 'SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL';
    const result = await this.pool.query<AccountRow>(sql, [id]);
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

  async updateAvatar(id: string, avatar: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `UPDATE accounts SET avatar = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, avatar],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async updateVisibility(id: string, visibility: ProfileVisibility): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `UPDATE accounts SET profile_visibility = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, visibility],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async updateInsider(id: string, insider: boolean): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `UPDATE accounts SET insider = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, insider],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async softDelete(id: string): Promise<Account | null> {
    // Stamp deleted_at and free the unique-constrained identity columns so the same email + gamer tag
    // can be registered again (spec 0040). The display gamer_tag + nickname are kept so the admin
    // console still shows who the row was. Tombstoning to a value derived from the id keeps both
    // unique columns collision-free. Idempotent-ish: a second call rewrites to the same tombstone.
    const result = await this.pool.query<AccountRow>(
      `UPDATE accounts
         SET deleted_at = COALESCE(deleted_at, now()),
             email = 'deleted-' || id || '@deleted.invalid',
             gamer_tag_normalized = 'deleted-' || id,
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async hardDelete(id: string): Promise<boolean> {
    // Remove the row outright (spec 0040). account_game_plays cascades (FK ON DELETE CASCADE); the
    // credit ledger is kept by design (append-only audit) and rooms are left intact (their history is
    // shared across participants). Sessions self-revoke on next use once the row is gone.
    const result = await this.pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listAccounts(opts: ListAccountsOptions): Promise<AccountPage> {
    const query = (opts.query ?? '').trim().toLowerCase();
    // Match a gamer-tag substring; `LIKE` on the normalized column with the pattern parameterized so
    // a `%`/`_` in the input is escaped (it is a literal value, never concatenated into the SQL).
    if (query) {
      const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
      const items = await this.pool.query<AccountRow>(
        `SELECT * FROM accounts WHERE gamer_tag_normalized LIKE $1 ESCAPE '\\'
         ORDER BY gamer_tag_normalized LIMIT $2 OFFSET $3`,
        [pattern, opts.limit, opts.offset],
      );
      const count = await this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM accounts WHERE gamer_tag_normalized LIKE $1 ESCAPE '\\'`,
        [pattern],
      );
      return { items: items.rows.map(mapRow), total: Number(count.rows[0]!.count) };
    }
    const items = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts ORDER BY gamer_tag_normalized LIMIT $1 OFFSET $2`,
      [opts.limit, opts.offset],
    );
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM accounts`,
    );
    return { items: items.rows.map(mapRow), total: Number(count.rows[0]!.count) };
  }
}
