import {
  DuplicateCodeError,
  type RecordedGame,
  type RecordedRound,
  type Room,
  type RoomConfig,
  type RoomRepository,
  type RoomStatus,
} from './repository';

/**
 * In-memory room store for tests. Mirrors the Postgres store's uniqueness rule (join code) and
 * idempotency (round id, game id) so the room service runs without a live database.
 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly byId = new Map<string, Room>();
  private readonly rounds = new Map<string, RecordedRound>();
  private readonly games = new Map<string, RecordedGame>();
  private counter = 0;

  /** Test accessor: the completed games recorded so far (with their standings + stars), so a test
   * can assert the awarded stars the way the Postgres store persists them. */
  recordedGames(): RecordedGame[] {
    return [...this.games.values()];
  }

  /** Test accessor: the rounds recorded so far (with their scoring + standings). */
  recordedRounds(): RecordedRound[] {
    return [...this.rounds.values()];
  }

  async create(hostAccountId: string, code: string): Promise<Room> {
    for (const room of this.byId.values()) {
      if (room.code === code) {
        throw new DuplicateCodeError(code);
      }
    }
    const now = new Date();
    const room: Room = {
      id: `room_${++this.counter}`,
      code,
      hostAccountId,
      selectedGame: null,
      config: null,
      status: 'lobby',
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(room.id, room);
    return { ...room };
  }

  async findByCode(code: string): Promise<Room | null> {
    for (const room of this.byId.values()) {
      if (room.code === code) {
        return { ...room };
      }
    }
    return null;
  }

  async findById(id: string): Promise<Room | null> {
    const room = this.byId.get(id);
    return room ? { ...room } : null;
  }

  async setSelectedGame(id: string, game: string, config: RoomConfig): Promise<Room | null> {
    const room = this.byId.get(id);
    if (!room) {
      return null;
    }
    room.selectedGame = game;
    room.config = config;
    room.updatedAt = new Date();
    return { ...room };
  }

  async setStatus(id: string, status: RoomStatus): Promise<Room | null> {
    const room = this.byId.get(id);
    if (!room) {
      return null;
    }
    room.status = status;
    room.updatedAt = new Date();
    return { ...room };
  }

  async recordRound(round: RecordedRound): Promise<boolean> {
    if (this.rounds.has(round.roundId)) {
      return false;
    }
    this.rounds.set(round.roundId, round);
    return true;
  }

  async recordGame(game: RecordedGame): Promise<boolean> {
    if (this.games.has(game.gameId)) {
      return false;
    }
    this.games.set(game.gameId, game);
    return true;
  }
}
