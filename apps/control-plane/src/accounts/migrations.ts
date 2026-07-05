import type { Migration } from '../db/migrations';

/**
 * The accounts domain's schema migrations. Owned here; the composition root
 * (src/migrations.ts) concatenates these with other domains' entries and hands them to the
 * generic runner in db/migrations.ts. Append the next id for a change; never edit a shipped one.
 */
export const accountMigrations: Migration[] = [
  {
    id: 1,
    name: 'create_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email                text NOT NULL,
        password_hash        text NOT NULL,
        gamer_tag            text NOT NULL,
        gamer_tag_normalized text NOT NULL,
        nickname             text NOT NULL,
        email_verified       boolean NOT NULL DEFAULT false,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_key
        ON accounts (email);
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_gamer_tag_normalized_key
        ON accounts (gamer_tag_normalized);
    `,
  },
];
