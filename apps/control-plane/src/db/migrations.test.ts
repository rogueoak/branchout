import { describe, expect, it } from 'vitest';
import { type Migration, runMigrations } from './migrations';

/**
 * A fake Postgres pool that models just enough for the migration runner: a `schema_migrations`
 * ledger and per-connection transactions. It records the DDL each migration ran so a test can
 * assert both application and idempotency without a live database.
 */
function createFakePool() {
  const applied = new Set<number>();
  const ranSql: string[] = [];

  const runQuery = (sql: string, params?: unknown[]) => {
    const text = sql.trim();
    if (text.startsWith('SELECT id FROM schema_migrations')) {
      const id = params?.[0] as number;
      return { rowCount: applied.has(id) ? 1 : 0, rows: applied.has(id) ? [{ id }] : [] };
    }
    if (text.startsWith('INSERT INTO schema_migrations')) {
      applied.add(params?.[0] as number);
      return { rowCount: 1, rows: [] };
    }
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rowCount: 0, rows: [] };
    }
    // Ledger DDL or a migration body.
    ranSql.push(text);
    return { rowCount: 0, rows: [] };
  };

  const pool = {
    query: async (sql: string, params?: unknown[]) => runQuery(sql, params),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => runQuery(sql, params),
      release: () => {},
    }),
  };

  return { pool, applied, ranSql };
}

const migrations: Migration[] = [
  { id: 1, name: 'first', sql: 'CREATE TABLE first ();' },
  { id: 2, name: 'second', sql: 'CREATE TABLE second ();' },
];

describe('runMigrations', () => {
  it('applies every pending migration in order', async () => {
    const { pool, applied, ranSql } = createFakePool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runMigrations(pool as any, migrations);
    expect(result).toEqual([1, 2]);
    expect([...applied]).toEqual([1, 2]);
    expect(ranSql).toContain('CREATE TABLE first ();');
    expect(ranSql).toContain('CREATE TABLE second ();');
  });

  it('is idempotent: a second run applies nothing', async () => {
    const { pool } = createFakePool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runMigrations(pool as any, migrations);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await runMigrations(pool as any, migrations);
    expect(second).toEqual([]);
  });

  it('applies only the new migration when one is added later', async () => {
    const { pool } = createFakePool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runMigrations(pool as any, [migrations[0]!]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next = await runMigrations(pool as any, migrations);
    expect(next).toEqual([2]);
  });
});
