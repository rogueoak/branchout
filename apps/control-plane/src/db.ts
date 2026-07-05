import { Pool } from 'pg';

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/** True if a trivial query round-trips. Never throws; a down database returns false. */
export async function pingPostgres(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
