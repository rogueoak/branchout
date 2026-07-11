import type { Migration } from '../db/migrations';

/**
 * The profiles domain schema (spec 0027). Per-account game history so a public profile can total a
 * player's stars and list their recent games - `room_games.stars` is keyed by the ephemeral
 * `playerId`, not an account, so it cannot. One row per (account, completed game); the composite
 * primary key makes the game-complete write idempotent (a report retry is a no-op).
 */
export const profileMigrations: Migration[] = [
  {
    id: 5,
    name: 'create_account_game_plays',
    sql: `
      CREATE TABLE IF NOT EXISTS account_game_plays (
        account_id uuid        NOT NULL,
        game_id    text        NOT NULL,
        game       text        NOT NULL,
        rank       integer     NOT NULL,
        stars      integer     NOT NULL,
        played_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, game_id)
      );
      CREATE INDEX IF NOT EXISTS account_game_plays_account_recent
        ON account_game_plays (account_id, played_at DESC);
    `,
  },
];
