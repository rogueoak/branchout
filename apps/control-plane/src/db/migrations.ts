import type { Pool } from 'pg';

/**
 * A minimal, forward-only migration runner - service-wide infrastructure, domain-neutral. The
 * scaffold only had a connectivity check; this gives the control-plane a documented way to
 * create and evolve its schema without a migration framework. Each migration runs once, in
 * order, inside a transaction, recorded in `schema_migrations` so a restart is idempotent.
 *
 * Each domain (accounts, rooms, ...) owns its own migration entries; the composition root
 * (src/migrations.ts) concatenates them and hands the list here. To add a change: append a new
 * entry with the next id. Never edit or reorder a shipped migration - add another one.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

/**
 * Apply every migration not yet recorded, in id order. Returns the ids applied this run
 * (empty when the schema is already current). Safe to call on every boot.
 */
export async function runMigrations(pool: Pool, migrations: Migration[]): Promise<number[]> {
  await pool.query(LEDGER_DDL);
  const applied: number[] = [];
  const ordered = [...migrations].sort((a, b) => a.id - b.id);

  for (const migration of ordered) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const already = await client.query<{ id: number }>(
        'SELECT id FROM schema_migrations WHERE id = $1',
        [migration.id],
      );
      if (already.rowCount === 0) {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [
          migration.id,
          migration.name,
        ]);
        applied.push(migration.id);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}
