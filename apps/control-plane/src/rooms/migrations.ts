import type { Migration } from '../db/migrations';

/**
 * The rooms domain's schema. Owned here; the composition root (src/migrations.ts) concatenates
 * these after the accounts entries (id 1) and hands them to the generic runner. Append the next id
 * for a change; never edit a shipped one.
 *
 * `rooms` is the durable room record; `room_rounds` and `room_games` are the game history the
 * engine reports back. Both history tables key on the engine's stable report id (`round_id`,
 * `game_id`) as the primary key, so a retried report is a no-op insert - the schema itself
 * enforces "record once".
 */
export const roomMigrations: Migration[] = [
  {
    id: 2,
    name: 'create_rooms',
    sql: `
      CREATE TABLE IF NOT EXISTS rooms (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code            text NOT NULL,
        host_account_id uuid NOT NULL,
        selected_game   text,
        config          jsonb,
        status          text NOT NULL DEFAULT 'lobby',
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_key ON rooms (code);

      CREATE TABLE IF NOT EXISTS room_rounds (
        round_id    text PRIMARY KEY,
        room_id     uuid NOT NULL REFERENCES rooms (id),
        game        text NOT NULL,
        round       integer NOT NULL,
        scores      jsonb NOT NULL,
        standings   jsonb NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS room_rounds_room_id ON room_rounds (room_id);

      CREATE TABLE IF NOT EXISTS room_games (
        game_id     text PRIMARY KEY,
        room_id     uuid NOT NULL REFERENCES rooms (id),
        game        text NOT NULL,
        standings   jsonb NOT NULL,
        stars       jsonb NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS room_games_room_id ON room_games (room_id);
    `,
  },
];
