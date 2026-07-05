import type { Pool } from 'pg';
import type { Standing } from '@branchout/protocol';
import type { StarAward } from '../credits/stars';

/** A room's lifecycle state. A room outlives a game: it returns to `lobby` after each one. */
export type RoomStatus = 'lobby' | 'running';

/** A room's opaque game config - validated by the engine's game module, passed through unchanged. */
export type RoomConfig = unknown;

/**
 * The durable room record. The room's existence, its host, its selected game, and its status are
 * the facts that must survive a restart, so they live in Postgres; live membership and presence
 * live in Redis (see membership.ts).
 */
export interface Room {
  id: string;
  code: string;
  hostAccountId: string;
  selectedGame: string | null;
  config: RoomConfig;
  status: RoomStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** One recorded round's scoring - the per-round history the engine reports back. */
export interface RecordedRound {
  roundId: string;
  roomId: string;
  game: string;
  round: number;
  scores: unknown;
  standings: Standing[];
}

/** One completed game's final standings and the stars they converted to - the game history. */
export interface RecordedGame {
  gameId: string;
  roomId: string;
  game: string;
  standings: Standing[];
  stars: StarAward[];
}

/** Raised when a generated join code collides with an existing room (retry with a fresh code). */
export class DuplicateCodeError extends Error {
  constructor(public code: string) {
    super(`room code ${code} already exists`);
    this.name = 'DuplicateCodeError';
  }
}

/**
 * Persistence for rooms and their game history. Behind an interface so the room service is
 * testable without a live Postgres: `InMemoryRoomRepository` backs unit tests,
 * `PostgresRoomRepository` runs in production. Round and game recording are idempotent by the
 * engine's stable ids so a retried report is not double-recorded.
 */
export interface RoomRepository {
  create(hostAccountId: string, code: string): Promise<Room>;
  findByCode(code: string): Promise<Room | null>;
  findById(id: string): Promise<Room | null>;
  setSelectedGame(id: string, game: string, config: RoomConfig): Promise<Room | null>;
  setStatus(id: string, status: RoomStatus): Promise<Room | null>;
  /** Record a round's scoring; returns false if this `roundId` was already recorded. */
  recordRound(round: RecordedRound): Promise<boolean>;
  /** Record a completed game's standings + stars; false if this `gameId` was already recorded. */
  recordGame(game: RecordedGame): Promise<boolean>;
}

interface RoomRow {
  id: string;
  code: string;
  host_account_id: string;
  selected_game: string | null;
  config: RoomConfig;
  status: RoomStatus;
  created_at: Date;
  updated_at: Date;
}

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    hostAccountId: row.host_account_id,
    selectedGame: row.selected_game,
    config: row.config,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PG_UNIQUE_VIOLATION = '23505';

/** Postgres-backed room store. All queries are parameterized - never string-built. */
export class PostgresRoomRepository implements RoomRepository {
  constructor(private readonly pool: Pool) {}

  async create(hostAccountId: string, code: string): Promise<Room> {
    try {
      const result = await this.pool.query<RoomRow>(
        `INSERT INTO rooms (code, host_account_id) VALUES ($1, $2) RETURNING *`,
        [code, hostAccountId],
      );
      return mapRoom(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateCodeError(code);
      }
      throw error;
    }
  }

  async findByCode(code: string): Promise<Room | null> {
    const result = await this.pool.query<RoomRow>('SELECT * FROM rooms WHERE code = $1', [code]);
    const row = result.rows[0];
    return row ? mapRoom(row) : null;
  }

  async findById(id: string): Promise<Room | null> {
    const result = await this.pool.query<RoomRow>('SELECT * FROM rooms WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapRoom(row) : null;
  }

  async setSelectedGame(id: string, game: string, config: RoomConfig): Promise<Room | null> {
    const result = await this.pool.query<RoomRow>(
      `UPDATE rooms SET selected_game = $2, config = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, game, JSON.stringify(config ?? null)],
    );
    const row = result.rows[0];
    return row ? mapRoom(row) : null;
  }

  async setStatus(id: string, status: RoomStatus): Promise<Room | null> {
    const result = await this.pool.query<RoomRow>(
      `UPDATE rooms SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    const row = result.rows[0];
    return row ? mapRoom(row) : null;
  }

  async recordRound(round: RecordedRound): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO room_rounds (round_id, room_id, game, round, scores, standings)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (round_id) DO NOTHING`,
      [
        round.roundId,
        round.roomId,
        round.game,
        round.round,
        JSON.stringify(round.scores),
        JSON.stringify(round.standings),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recordGame(game: RecordedGame): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO room_games (game_id, room_id, game, standings, stars)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id) DO NOTHING`,
      [
        game.gameId,
        game.roomId,
        game.game,
        JSON.stringify(game.standings),
        JSON.stringify(game.stars),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
