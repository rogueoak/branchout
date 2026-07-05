import type { Migration } from '../db/migrations';

/**
 * The credits domain's schema. Owned here; the composition root (src/migrations.ts) concatenates
 * these after the accounts (id 1) and rooms entries and hands them to the generic runner. Append
 * the next id for a change; never edit a shipped one.
 *
 * The ledger is append-only: a signed `delta` per row, balance is their sum. The unique index on
 * `idempotency_key` is the guarantee that a daily grant lands once per day and a round debits once
 * per round - the database, not the caller, enforces "bill exactly once".
 */
export const creditMigrations: Migration[] = [
  {
    id: 3,
    name: 'create_credit_ledger',
    sql: `
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id      uuid NOT NULL,
        delta           integer NOT NULL,
        reason          text NOT NULL,
        idempotency_key text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_idempotency_key
        ON credit_ledger (idempotency_key);
      CREATE INDEX IF NOT EXISTS credit_ledger_account_id
        ON credit_ledger (account_id);
    `,
  },
];
