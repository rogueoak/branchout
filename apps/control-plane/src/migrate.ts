import { loadConfig } from './config';
import { createPostgresPool } from './db';
import { runMigrations } from './accounts/migrations';

/**
 * Standalone migration entry: apply pending migrations and exit. Startup also runs migrations
 * (see index.ts), so this is for running them deliberately - `pnpm --filter
 * @branchout/control-plane migrate` - without booting the whole service.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPostgresPool(config.databaseUrl);
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length > 0
        ? `[control-plane] applied migrations ${applied.join(', ')}`
        : '[control-plane] schema up to date',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[control-plane] migration failed', error);
  process.exitCode = 1;
});
