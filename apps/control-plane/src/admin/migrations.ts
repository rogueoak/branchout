import type { Migration } from '../db/migrations';

/**
 * The admin domain's schema (spec 0037). Admins are a SEPARATE identity from player `accounts` -
 * their own table, so an operator is never in the player pool, reachable from the public login, or
 * carried by the player session cookie. Appended to the global set in `src/migrations.ts`; the next
 * free id after accounts(1,4,6)/rooms(2)/credits(3)/profiles(5) is 7. Never edit a shipped one.
 */
export const adminMigrations: Migration[] = [
  {
    id: 7,
    name: 'create_admin_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS admin_accounts (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email            text NOT NULL,
        email_normalized text NOT NULL,
        password_hash    text NOT NULL,
        created_by       uuid REFERENCES admin_accounts (id),
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_email_normalized_key
        ON admin_accounts (email_normalized);
    `,
  },
];
