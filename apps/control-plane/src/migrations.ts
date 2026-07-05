import { accountMigrations } from './accounts/migrations';
import type { Migration } from './db/migrations';

/**
 * The full, ordered migration set for the control-plane, assembled at the composition root.
 * Each domain owns its own entries; concatenate them here so the generic runner applies the
 * whole schema. New domains (rooms, billing) add their list to this array.
 */
export const allMigrations: Migration[] = [...accountMigrations];
