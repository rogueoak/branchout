import { accountMigrations } from './accounts/migrations';
import { adminMigrations } from './admin/migrations';
import { creditMigrations } from './credits/migrations';
import type { Migration } from './db/migrations';
import { profileMigrations } from './profiles/migrations';
import { roomMigrations } from './rooms/migrations';

/**
 * The full, ordered migration set for the control-plane, assembled at the composition root.
 * Each domain owns its own entries; concatenate them here so the generic runner applies the
 * whole schema. New domains add their list to this array (the runner sorts by id).
 */
export const allMigrations: Migration[] = [
  ...accountMigrations,
  ...roomMigrations,
  ...creditMigrations,
  ...profileMigrations,
  ...adminMigrations,
];
