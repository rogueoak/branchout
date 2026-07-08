import type {
  GameCompleteReport,
  HandoffPlayer,
  RoundReport,
  StartHandoffRequest,
} from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { CreditLedger } from '../credits/ledger';
import { standingsToStars } from '../credits/stars';
import type { Session } from '../sessions/session';
import { canHost } from '../sessions/session';
import { validateDisplayName } from '../validation/display-name';
import { generateCode, shareLink } from './code';
import type { ControlAction, EngineClient } from './engine-client';
import {
  hasViewer,
  newPlayerId,
  type Mode,
  type MembershipStore,
  type RoomMember,
} from './membership';
import { DuplicateCodeError, type Room, type RoomConfig, type RoomRepository } from './repository';

/** How many fresh codes to try before giving up when they keep colliding (astronomically rare). */
const CODE_ATTEMPTS = 8;

/** A room error with a stable code the routes map to an HTTP status and a user-safe message. */
export class RoomError extends Error {
  constructor(
    public code:
      | 'forbidden'
      | 'not_found'
      | 'kicked'
      | 'no_game'
      | 'no_viewer'
      | 'insufficient_credits'
      | 'invalid'
      | 'engine',
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

/** What a joiner supplies: the role they want, their per-game nickname, and (for a player) mode. */
export interface JoinInput {
  role: 'player' | 'observer';
  nickname: string;
  mode?: Mode;
}

/** A room plus its shareable tap-to-join link - what the create/join endpoints return. */
export interface RoomView {
  id: string;
  code: string;
  shareLink: string;
  status: Room['status'];
  selectedGame: string | null;
  hostAccountId: string;
}

/**
 * What `join` returns: the room, plus the caller's own public `playerId`. The browser needs its
 * `playerId` to `join` the engine (the roster is keyed by it), and a non-host cannot read it from
 * `/members` (it cannot tell which row is its own without a `sessionId`), so `join` echoes it back.
 */
export interface JoinResult {
  room: RoomView;
  playerId: string;
}

/**
 * What `createRoom` returns: the room plus the host's own public `playerId` (mirrors {@link
 * JoinResult}). The host needs its `playerId` to `join` the engine as a player. Without it echoed
 * here, a host reloading mid-game (when the roster poll is skipped) has no engine identity until
 * `/members` loads, so it is wrongly bounced to the rejoin screen.
 */
export interface CreateResult {
  room: RoomView;
  playerId: string;
}

function toView(room: Room): RoomView {
  return {
    id: room.id,
    code: room.code,
    shareLink: shareLink(room.code),
    status: room.status,
    selectedGame: room.selectedGame,
    hostAccountId: room.hostAccountId,
  };
}

/**
 * Rooms orchestration: create/join/kick, game selection, the start handoff to the engine, host
 * controls, and the engine's round/complete report intake. The system-of-record split lives here:
 * durable room + history in Postgres (`RoomRepository`), live membership/presence/mode in Redis
 * (`MembershipStore`), credits in the ledger. The service gates a start on viewers and credits;
 * the engine owns the game itself.
 */
export class RoomService {
  constructor(
    private readonly repo: RoomRepository,
    private readonly membership: MembershipStore,
    private readonly ledger: CreditLedger,
    private readonly engine: EngineClient,
  ) {}

  /**
   * Create a room for a signed-in host. Only an account session may host (anonymous players never
   * host - spec 0004's `canHost`). The host joins as a full player (`role: 'player'`) with
   * `isHost: true` and their session nickname, so it flows through the same roster/answer/standings
   * machinery as any player while `isHost` carries the admin powers. Its mode defaults to
   * `interactive` here (a safe viewer fallback); the client refines it from the device via
   * `setMode`. A fresh 5-character code is generated and retried on the astronomically rare
   * collision.
   */
  async createRoom(session: Session): Promise<CreateResult> {
    if (!canHost(session) || !session.accountId) {
      throw new RoomError('forbidden', 'Sign in to host a room.');
    }
    const room = await this.createWithUniqueCode(session.accountId);
    const host: RoomMember = {
      sessionId: session.id,
      playerId: newPlayerId(),
      accountId: session.accountId,
      role: 'player',
      isHost: true,
      mode: normalizeMode(undefined),
      nickname: session.displayName,
      connected: true,
    };
    await this.membership.put(room.id, host);
    // Echo the host's public playerId (like `join` does) so the browser has its engine identity
    // immediately, without waiting on the members list - a host reloading mid-game must not be
    // bounced to rejoin for lack of an identity.
    return { room: toView(room), playerId: host.playerId };
  }

  private async createWithUniqueCode(hostAccountId: string): Promise<Room> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.repo.create(hostAccountId, generateCode());
      } catch (error) {
        if (error instanceof DuplicateCodeError) {
          continue;
        }
        throw error;
      }
    }
    throw new RoomError('invalid', 'Could not allocate a unique room code; try again.');
  }

  /**
   * Join a room by code as a player or observer with a chosen per-game nickname. A kicked session
   * may not rejoin (the code still works for everyone else). A player's mode defaults to
   * `interactive`; an observer has no mode.
   */
  async join(code: string, session: Session, input: JoinInput): Promise<JoinResult> {
    const room = await this.requireRoom(code);
    if (await this.membership.isKicked(room.id, session.id)) {
      throw new RoomError('kicked', 'You were removed from this room and cannot rejoin.');
    }
    const name = validateDisplayName(input.nickname);
    if (!name.ok) {
      throw new RoomError('invalid', name.error!);
    }
    if (input.role !== 'player' && input.role !== 'observer') {
      throw new RoomError('invalid', 'Choose to join as a player or an observer.');
    }
    // Reuse the playerId if this session is already a member (a rejoin), so a reconnecting device
    // keeps the identity the engine roster already knows; mint a fresh one for a first join.
    const existing = await this.membership.get(room.id, session.id);
    // Derive host status from the room, never the request: the host is whoever owns the room in
    // Postgres (`hostAccountId`). A host re-entering via the rejoin link - even as an observer -
    // must not be able to demote itself, or the invariant `isHost => role === 'player'` breaks
    // (host dropped from the roster, loses sessionId visibility, and the kick-guard is defeated)
    // while `requireHost` still authorizes them. So we re-derive and force the host back to a
    // full player here rather than trusting `input.role`/`isHost: false`.
    const isHost = !!session.accountId && session.accountId === room.hostAccountId;
    const member: RoomMember = {
      sessionId: session.id,
      playerId: existing?.playerId ?? newPlayerId(),
      ...(session.accountId ? { accountId: session.accountId } : {}),
      // The host is always a player; a non-host joins with the role they asked for.
      role: isHost ? 'player' : input.role,
      isHost,
      // A player has a mode; observers have none. The host keeps its existing mode across a rejoin
      // (so it is not knocked off its chosen setup) and otherwise takes the requested/normalized
      // default; a non-host player takes the mode it asked for.
      ...(isHost
        ? { mode: existing?.mode ?? normalizeMode(input.mode) }
        : input.role === 'player'
          ? { mode: normalizeMode(input.mode) }
          : {}),
      nickname: name.value!,
      connected: true,
    };
    await this.membership.put(room.id, member);
    return { room: toView(room), playerId: member.playerId };
  }

  /** A player switches interactive/remote mode. The host is a player, so it sets its mode here too;
   * only observers have no mode. */
  async setMode(code: string, session: Session, mode: Mode): Promise<void> {
    const room = await this.requireRoom(code);
    const member = await this.membership.get(room.id, session.id);
    if (!member || member.role !== 'player') {
      throw new RoomError('invalid', 'Only a player can choose a mode.');
    }
    member.mode = normalizeMode(mode);
    await this.membership.put(room.id, member);
  }

  /**
   * The host selects a game and its config. The config is *opaque*: the control-plane validates
   * only that a game is named and passes the blob through to the engine unchanged (spec 0006). The
   * game module (spec 0007/0008) owns config validation.
   */
  async selectGame(
    code: string,
    session: Session,
    game: string,
    config: RoomConfig,
  ): Promise<RoomView> {
    const room = await this.requireHost(code, session);
    if (typeof game !== 'string' || game.trim().length === 0) {
      throw new RoomError('no_game', 'Select a game first.');
    }
    const updated = await this.repo.setSelectedGame(room.id, game.trim(), config);
    return toView(updated ?? room);
  }

  /**
   * Start the selected game. Runs every gate in order: a game must be selected, at least one
   * viewer must be present, and the host must be able to afford the requested rounds. Only when
   * all pass does it hand off to the engine and mark the room running - a failed gate refuses the
   * start with a clear reason and makes no engine call.
   */
  async start(code: string, session: Session, rounds: number): Promise<RoomView> {
    const room = await this.requireHost(code, session);
    if (!room.selectedGame) {
      throw new RoomError('no_game', 'Select a game before starting.');
    }
    const requested = Number.isInteger(rounds) && rounds > 0 ? rounds : 1;

    const members = await this.membership.list(room.id);
    if (!hasViewer(members)) {
      throw new RoomError(
        'no_viewer',
        'A game needs at least one viewer: an observer or an interactive player.',
      );
    }

    // Affordability is checked but nothing is reserved or debited at start (spec 0006 scopes
    // single-game credit reservation out; debits happen per reported round). Known, explicitly
    // deferred limitation: a host with several concurrent running rooms can drive the ledger
    // negative, since each start sees the same balance. A hold-at-start reservation and/or a
    // one-running-game-per-host cap is deferred to the Purchases/reservation spec. See
    // docs/feedback/0004-rooms-security-review.md.
    const affordability = await this.ledger.canAfford(room.hostAccountId, requested);
    if (!affordability.ok) {
      throw new RoomError('insufficient_credits', affordability.reason!);
    }

    const request: StartHandoffRequest = {
      v: PROTOCOL_VERSION,
      room: room.id,
      game: room.selectedGame,
      players: toHandoffPlayers(members),
      config: room.config,
    };
    await this.engine.start(request);

    const running = await this.repo.setStatus(room.id, 'running');
    return toView(running ?? room);
  }

  /**
   * Proxy a host control to the engine. `exit` also returns the room to the lobby so it can host
   * another game (the room outlives a single match). Pause and restart only reach the engine.
   */
  async control(code: string, session: Session, action: ControlAction): Promise<RoomView> {
    const room = await this.requireHost(code, session);
    if (!room.selectedGame) {
      throw new RoomError('no_game', 'No game is running.');
    }
    await this.engine.control(room.id, room.selectedGame, action);
    if (action === 'exit') {
      const lobby = await this.repo.setStatus(room.id, 'lobby');
      return toView(lobby ?? room);
    }
    return toView(room);
  }

  /**
   * The host kicks a member: they are removed from membership and barred from rejoining on the
   * same session; the code still works for anyone else. The host is not kickable - neither itself
   * (the self-kick guard) nor via another host session (the `isHost` guard).
   */
  async kick(code: string, session: Session, targetSessionId: string): Promise<void> {
    const room = await this.requireHost(code, session);
    if (!targetSessionId || targetSessionId === session.id) {
      throw new RoomError('invalid', 'Choose another member to remove.');
    }
    const target = await this.membership.get(room.id, targetSessionId);
    if (target?.isHost) {
      throw new RoomError('invalid', 'The host cannot be removed.');
    }
    await this.membership.kick(room.id, targetSessionId);
  }

  /**
   * List a room's members. The caller must be a member (knowing a 5-character code is not enough to
   * enumerate a room), and only the host (`isHost`) sees each member's `sessionId` - it is the kick
   * target and rejoin key, so it stays host-only. `playerId` is public (the engine broadcasts it in
   * `state`), so it stays on every row: it is how the host reads its own engine identity from its
   * own row.
   */
  /**
   * The current room view for a member. Callers poll this to learn when the host has started the
   * game (`status` flips to `running`) or returned it to the lobby, so a non-host device - which
   * never runs the host's start handler - can transition into and out of the game. The caller must
   * be a member; knowing the code is not enough.
   */
  async view(code: string, session: Session): Promise<RoomView> {
    const room = await this.requireRoom(code);
    const caller = await this.membership.get(room.id, session.id);
    if (!caller) {
      throw new RoomError('forbidden', 'Join the room to see it.');
    }
    return toView(room);
  }

  async members(
    code: string,
    session: Session,
  ): Promise<Array<Omit<RoomMember, 'sessionId'> & { sessionId?: string }>> {
    const room = await this.requireRoom(code);
    const caller = await this.membership.get(room.id, session.id);
    if (!caller) {
      throw new RoomError('forbidden', 'Join the room to see its members.');
    }
    const all = await this.membership.list(room.id);
    if (caller.isHost) {
      return all;
    }
    return all.map((m) => {
      const redacted: Omit<RoomMember, 'sessionId'> & { sessionId?: string } = { ...m };
      delete redacted.sessionId;
      return redacted;
    });
  }

  /**
   * Intake for the engine's per-round report. The single place a round is billed: it records the
   * round's scoring and debits one credit from the host, both idempotent by `roundId`, so a
   * retried report neither double-records nor double-bills. Returns `recorded` the first time and
   * `duplicate` on a retry.
   */
  async recordRound(report: RoundReport): Promise<'recorded' | 'duplicate'> {
    const room = await this.repo.findById(report.room);
    if (!room) {
      throw new RoomError('not_found', 'Unknown room for round report.');
    }
    const recorded = await this.repo.recordRound({
      roundId: report.roundId,
      roomId: room.id,
      game: report.game,
      round: report.round,
      scores: report.scores,
      standings: report.standings,
    });
    // Debit unconditionally: the ledger is idempotent by `roundId`, so a round is still billed
    // exactly once, AND a retried report heals a debit that failed after a prior record had
    // already succeeded. Gating the debit on `recorded` would silently drop the charge in that
    // crash-between-two-awaits case (feedback 0003: dedupe alone turns a transient failure into
    // silent loss).
    await this.ledger.debitRound(room.hostAccountId, report.roundId);
    return recorded ? 'recorded' : 'duplicate';
  }

  /**
   * Intake for the engine's game-complete report. Converts the final standings to stars (3/2/1 by
   * rank, ties share) and records them, idempotent by `gameId`. On the first record it returns the
   * room to the lobby so the host can start another game (allowance is re-checked at the next
   * start). Returns `recorded` the first time, `duplicate` on a retry.
   */
  async recordGameComplete(report: GameCompleteReport): Promise<'recorded' | 'duplicate'> {
    const room = await this.repo.findById(report.room);
    if (!room) {
      throw new RoomError('not_found', 'Unknown room for game-complete report.');
    }
    const recorded = await this.repo.recordGame({
      gameId: report.gameId,
      roomId: room.id,
      game: report.game,
      standings: report.standings,
      stars: standingsToStars(report.standings),
    });
    if (recorded) {
      await this.repo.setStatus(room.id, 'lobby');
    }
    return recorded ? 'recorded' : 'duplicate';
  }

  private async requireRoom(code: string): Promise<Room> {
    const room = await this.repo.findByCode(normalizeCode(code));
    if (!room) {
      throw new RoomError('not_found', 'No room with that code.');
    }
    return room;
  }

  /** Load the room and assert the session is its signed-in host. */
  private async requireHost(code: string, session: Session): Promise<Room> {
    const room = await this.requireRoom(code);
    if (!canHost(session) || session.accountId !== room.hostAccountId) {
      throw new RoomError('forbidden', 'Only the room host can do that.');
    }
    return room;
  }
}

/** Normalize a submitted code to the stored form (uppercase, trimmed). */
function normalizeCode(code: string): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/** A player's mode defaults to interactive; anything but `remote` is treated as interactive. */
function normalizeMode(mode: Mode | undefined): Mode {
  return mode === 'remote' ? 'remote' : 'interactive';
}

/**
 * Map room members to the engine's handoff players. Observers do not play; only players go. The
 * host is a `player` (with `isHost: true`), so it is intentionally included here and plays like any
 * other - this is what puts the host in the engine roster, the leaderboard, and the final
 * standings. The roster is keyed by the public `playerId` (not the httpOnly `sessionId`), so a
 * non-host browser that only ever learns its `playerId` can `join` the engine and match its slot.
 */
function toHandoffPlayers(members: readonly RoomMember[]): HandoffPlayer[] {
  return members
    .filter((member) => member.role === 'player')
    .map((member) => ({
      player: member.playerId,
      nickname: member.nickname,
      // Carry host identity so the engine can auto-pause while the host is disconnected (0014).
      isHost: member.isHost,
    }));
}
