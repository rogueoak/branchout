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
  {
    // Spec 0027: a public profile needs an avatar and a visibility. Both are added with safe
    // constant defaults so every existing row stays valid (the versioned-envelope learning); a
    // fresh signup overrides `avatar` with a deterministic per-tag default in the service.
    id: 4,
    name: 'add_account_profile_fields',
    sql: `
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT 'sprout';
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public';
    `,
  },
  {
    // Spec 0035: the insider surface gates on a per-account beta-tester flag. Added with a safe
    // constant default so every existing row stays valid (the versioned-envelope learning); it is
    // granted out-of-band (a DB update) until the admin console (spec 0037) ships a toggle.
    id: 6,
    name: 'add_account_insider',
    sql: `
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS insider boolean NOT NULL DEFAULT false;
    `,
  },
  {
    // Spec 0040: account deletion lifecycle. A nullable timestamp marks a soft-deleted account
    // (absent = live) - a self-service delete sets it, the admin console reads it to flag the row,
    // and an admin hard delete removes the row outright. Nullable with no default so every existing
    // row stays live (the versioned-envelope learning).
    id: 8,
    name: 'add_account_soft_delete',
    sql: `
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    `,
  },
];
