import type { LedgerEntry, LedgerRepository } from './repository';

/**
 * In-memory ledger for tests. Mirrors the Postgres store's idempotency rule (a unique
 * `idempotencyKey`) so the ledger service's grant/debit/balance logic runs without a database.
 */
export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly entries: LedgerEntry[] = [];
  private readonly keys = new Set<string>();

  async append(entry: LedgerEntry): Promise<boolean> {
    if (this.keys.has(entry.idempotencyKey)) {
      return false;
    }
    this.keys.add(entry.idempotencyKey);
    this.entries.push({ ...entry });
    return true;
  }

  async balance(accountId: string): Promise<number> {
    return this.entries
      .filter((entry) => entry.accountId === accountId)
      .reduce((sum, entry) => sum + entry.delta, 0);
  }

  /** Test-only: every entry recorded, in order, for asserting what was written. */
  all(): readonly LedgerEntry[] {
    return this.entries;
  }
}
