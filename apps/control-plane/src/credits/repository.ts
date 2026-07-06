import type { Pool } from 'pg';

/**
 * The credit ledger is append-only: every grant and debit is a row with a signed `delta`, and the
 * balance is their sum. Idempotency is enforced at the store with a unique `idempotency_key`, so a
 * repeated daily grant or a retried round debit inserts nothing the second time - the single place
 * "bill a round once" and "grant a day once" are guaranteed regardless of caller retries.
 */
export interface LedgerEntry {
  accountId: string;
  /** Signed change: a positive grant or a negative debit. */
  delta: number;
  /** Why the entry exists, for audit: `daily_grant` or `round_debit`. */
  reason: string;
  /** Unique key that makes the write idempotent (`grant:<acct>:<date>`, `debit:round:<id>`). */
  idempotencyKey: string;
}

/**
 * Persistence for the credit ledger. Behind an interface so the ledger service is testable
 * without a live Postgres: `InMemoryLedgerRepository` backs unit tests, `PostgresLedgerRepository`
 * runs in production.
 */
export interface LedgerRepository {
  /**
   * Append an entry unless one with the same `idempotencyKey` already exists. Returns `true` when
   * this call wrote the row, `false` when it was a duplicate (already applied) - the caller turns
   * that into `recorded` vs `duplicate`.
   */
  append(entry: LedgerEntry): Promise<boolean>;
  /** Sum of every delta for an account: its current balance. Zero when the account has no rows. */
  balance(accountId: string): Promise<number>;
}

interface SumRow {
  balance: string | null;
}

/** Postgres-backed ledger. All writes are idempotent via a unique index on `idempotency_key`. */
export class PostgresLedgerRepository implements LedgerRepository {
  constructor(private readonly pool: Pool) {}

  async append(entry: LedgerEntry): Promise<boolean> {
    // ON CONFLICT DO NOTHING makes the insert idempotent: a duplicate key writes no row and the
    // affected-row count is 0, which is exactly the "already applied" signal the caller needs.
    const result = await this.pool.query(
      `INSERT INTO credit_ledger (account_id, delta, reason, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [entry.accountId, entry.delta, entry.reason, entry.idempotencyKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async balance(accountId: string): Promise<number> {
    const result = await this.pool.query<SumRow>(
      `SELECT COALESCE(SUM(delta), 0)::bigint AS balance FROM credit_ledger WHERE account_id = $1`,
      [accountId],
    );
    return Number(result.rows[0]?.balance ?? 0);
  }
}
