import type {
  GameCompleteReport,
  HandoffPlayer,
  RoundReport,
  StartHandoffRequest,
} from '@branchout/protocol';
import { PROTOCOL_VERSION, playerLimits } from '@branchout/protocol';
import { CreditLedger } from '../credits/ledger';
import { standingsToStars } from '../credits/stars';
import type { Session } from '../sessions/session';
import { canHost } from '../sessions/session';
import { validateDisplayName } from '../validation/display-name';
import { generateCode, shareLink } from './code';
import type { ControlAction, EngineClient } from './engine-client';
import type { PlaysRecorder, RoomGamePlay } from './plays-recorder';
import {
  hasDisplay,
  isPlaying,
  newPlayerId,
  playingCount,
  type Mode,
  type MembershipStore,
  type RoomMember,
} from './membership';
import { DuplicateCodeError, type Room, type RoomConfig, type RoomRepository } from './repository';
import type { AccountRepository } from '../accounts/repository';

/** How many fresh codes to try before giving up when they keep colliding (astronomically rare). */
const CODE_ATTEMPTS = 8;

/**
 * Games gated to insiders (spec 0043). This mirrors each engine plugin manifest's
 * `visibility: 'insider'` and the web registry's picker filter; it is duplicated here because the
 * control-plane does not load the game packages. The web filter is only a UI convenience - THIS set
 * is the authoritative gate, so a crafted API call cannot start an insider game. Keep it in sync
 * when a game's visibility changes (a shared source of truth across the three layers is a follow-up).
 */
const INSIDER_GAME_IDS: ReadonlySet<string> = new Set(['teeter-tower']);

/** A room error with a stable code the routes map to an HTTP status and a user-safe message. */
export class RoomError extends Error {
  constructor(
    public code:
      | 'forbidden'
      | 'not_found'
      | 'not_member'
      | 'kicked'
      | 'no_game'
      | 'no_viewer'
      | 'too_few_players'
      | 'room_full'
      | 'insufficient_credits'
      | 'invalid'
      | 'engine',
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

/** What a joiner supplies: their per-game nickname and the mode they want (spec 0050). Mode is
 *  optional - the server defaults it (interactive) and may clamp a playing mode to `viewer` when the
 *  game is already at its player maximum. */
export interface JoinInput {
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
 * The public, unauthenticated preview of a room. Deliberately minimal: only what a link unfurl
 * (Open Graph) needs to pick the right share card. Unlike {@link RoomView} it carries no `id`,
 * `shareLink`, or `hostAccountId` and never any member/session data - a link crawler is not a
 * member and must not learn anything private from a room code.
 */
export interface RoomPreview {
  code: string;
  status: Room['status'];
  selectedGame: string | null;
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

/**
 * The caller's own seat in a room, for the web client to rebuild its per-tab membership after it
 * has forgotten (a closed tab clears `sessionStorage`). Returned by {@link RoomService.resume} /
 * `GET /rooms/:code/me`. `player` is the caller's public engine `playerId` (mirrors {@link
 * JoinResult}); `sessionId` is never included. A durable host whose ephemeral roster row has
 * expired is re-seated before this is built, so a returning host gets its host row back rather than
 * a `not_member`.
 */
export interface ResumeResult {
  room: RoomView;
  membership: {
    isHost: boolean;
    mode: Mode;
    nickname: string;
    player: string;
  };
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
 * Build the host's roster row from its account session. The host carries `isHost`, joins with its
 * account nickname, and defaults to `interactive` mode - the client refines the mode from the device
 * via `setMode`. Used both when a room is first created and when a durable host is re-seated after
 * its ephemeral row expired (feedback 0021); a fresh `playerId` is minted each time (the caller must
 * have an `accountId` - `canHost` guarantees it).
 */
function hostMember(session: Session): RoomMember {
  return {
    sessionId: session.id,
    playerId: newPlayerId(),
    accountId: session.accountId!,
    isHost: true,
    mode: normalizeMode(undefined),
    nickname: session.displayName,
    connected: true,
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
    private readonly plays: PlaysRecorder,
    private readonly accounts: Pick<AccountRepository, 'findById'>,
  ) {}

  /**
   * Enforce a game's insider visibility server-side (spec 0043). The web hides insider-only games
   * from the picker, but that is only a UI filter - this is the authoritative gate, so a crafted
   * `selectGame`/`start` call cannot start an insider game for a non-insider. An insider-only game
   * requires the host account to hold the insider role (the same flag that gates the insider
   * surface, spec 0035).
   */
  private async assertGameVisibleToHost(room: Room, game: string): Promise<void> {
    if (!INSIDER_GAME_IDS.has(game)) return;
    const host = await this.accounts.findById(room.hostAccountId);
    if (!host?.insider) {
      throw new RoomError('forbidden', 'That game is available to insiders only for now.');
    }
  }

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
    const host = hostMember(session);
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
   * Join a room by code with a chosen per-game nickname and mode (spec 0050). A kicked session may
   * not rejoin (the code still works for everyone else). Mode defaults to `interactive`; a requested
   * playing mode (`interactive`/`remote`) is clamped to `viewer` when the selected game is already at
   * its player maximum, since only viewers may join a full game.
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
    // Reuse the playerId if this session is already a member (a rejoin), so a reconnecting device
    // keeps the identity the engine roster already knows; mint a fresh one for a first join.
    const existing = await this.membership.get(room.id, session.id);
    // Derive host status from the room, never the request: the host is whoever owns the room in
    // Postgres (`hostAccountId`), so a host re-entering via a share link cannot lose its powers.
    const isHost = !!session.accountId && session.accountId === room.hostAccountId;
    // The host keeps its existing mode across a rejoin (so it is not knocked off its chosen setup);
    // otherwise take the requested/normalized default, then clamp a playing mode to viewer if full.
    const members = await this.membership.list(room.id);
    const desired = isHost
      ? (existing?.mode ?? normalizeMode(input.mode))
      : normalizeMode(input.mode);
    const mode = clampToMax(desired, room, members, session.id);
    const member: RoomMember = {
      sessionId: session.id,
      playerId: existing?.playerId ?? newPlayerId(),
      ...(session.accountId ? { accountId: session.accountId } : {}),
      isHost,
      mode,
      nickname: name.value!,
      connected: true,
    };
    await this.membership.put(room.id, member);
    return { room: toView(room), playerId: member.playerId };
  }

  /**
   * Switch a member's mode (spec 0050). Any member may become a `viewer`, but switching TO a playing
   * mode (`interactive`/`remote`) is refused when the selected game is already at its player maximum
   * (the caller's own current playing seat is excluded from that count, so a remote->interactive swap
   * at the cap is always allowed).
   */
  async setMode(code: string, session: Session, mode: Mode): Promise<void> {
    const room = await this.requireRoom(code);
    const member = await this.membership.get(room.id, session.id);
    if (!member) {
      throw new RoomError('not_member', 'Join the room to choose a mode.');
    }
    const next = normalizeMode(mode);
    if (isPlayingMode(next)) {
      const members = await this.membership.list(room.id);
      const { max } = playerLimits(room.selectedGame ?? '');
      const othersPlaying = playingCount(members.filter((m) => m.sessionId !== session.id));
      if (othersPlaying >= max) {
        throw new RoomError(
          'room_full',
          `This game is full at ${max} players. Join as a viewer to watch.`,
        );
      }
    }
    member.mode = next;
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
    await this.assertGameVisibleToHost(room, game.trim());
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
    // Defence in depth: re-check visibility at start, not just at select, so a game set by any path
    // still cannot be started by a non-insider.
    await this.assertGameVisibleToHost(room, room.selectedGame);
    const requested = Number.isInteger(rounds) && rounds > 0 ? rounds : 1;

    const members = await this.membership.list(room.id);
    if (!hasDisplay(members)) {
      throw new RoomError(
        'no_viewer',
        'A game needs a screen: someone in viewer or interactive mode.',
      );
    }
    // Minimum-players gate (spec 0050): the game needs at least `min` playing (interactive + remote)
    // members; viewers do not count. Enforced here as the authority, mirrored by the lobby's Start.
    const { min } = playerLimits(room.selectedGame);
    const playing = playingCount(members);
    if (playing < min) {
      throw new RoomError(
        'too_few_players',
        `This game needs at least ${min} player${min === 1 ? '' : 's'}. ${playing} so far.`,
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
    // `resolveCaller` re-seats a durable host whose ephemeral roster row has expired, so a host
    // polling past the Redis TTL is silently restored rather than 403'd off its own room.
    const caller = await this.resolveCaller(room, session);
    if (!caller) {
      throw new RoomError('forbidden', 'Join the room to see it.');
    }
    return toView(room);
  }

  /**
   * A public, unauthenticated room preview by code, for link unfurls (Open Graph). A crawler has
   * no session and is not a member, so `view` (member-gated) cannot serve it. This leaks only the
   * status and the selected game so the web app can pick the matching share card; it exposes no
   * room id, host, or member/session data. Throws `not_found` for an unknown code.
   */
  async preview(code: string): Promise<RoomPreview> {
    const room = await this.requireRoom(code);
    return { code: room.code, status: room.status, selectedGame: room.selectedGame };
  }

  async members(
    code: string,
    session: Session,
  ): Promise<Array<Omit<RoomMember, 'sessionId'> & { sessionId?: string }>> {
    const room = await this.requireRoom(code);
    const caller = await this.resolveCaller(room, session);
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
   * Rebuild the caller's own seat in a room. The web client remembers its membership only in per-tab
   * `sessionStorage`, which a closed tab clears; when it reloads with nothing remembered it calls
   * this to learn whether it is still in the room before falling back to the join screen. A durable
   * host (the account owning the room) whose ephemeral roster row has expired is re-seated here, so a
   * returning host is dropped straight back in with host powers instead of being told to re-join. A
   * caller who is genuinely not a member (and not the host) gets `not_member`, which the client reads
   * as "show the join prompt" - distinct from a transient error.
   */
  async resume(code: string, session: Session): Promise<ResumeResult> {
    const room = await this.requireRoom(code);
    const caller = await this.resolveCaller(room, session);
    if (!caller) {
      throw new RoomError('not_member', 'Join the room to enter it.');
    }
    return {
      room: toView(room),
      membership: {
        isHost: caller.isHost,
        mode: caller.mode,
        nickname: caller.nickname,
        player: caller.playerId,
      },
    };
  }

  /**
   * Resolve the caller's roster row, healing the durable-vs-ephemeral split (feedback 0021). Returns
   * the live row if present. Otherwise, if the session is the room's durable host (its account owns
   * the room in Postgres), re-seats the host as a full player with host powers and returns that -
   * the ephemeral row (Redis, 12h TTL) can vanish while `host_account_id` never does. Any other
   * caller with no row returns `null` (a guest must re-join). Re-seating mints a fresh `playerId`,
   * matching the existing `join`-after-expiry behaviour.
   */
  private async resolveCaller(room: Room, session: Session): Promise<RoomMember | null> {
    const existing = await this.membership.get(room.id, session.id);
    if (existing) {
      return existing;
    }
    if (canHost(session) && session.accountId === room.hostAccountId) {
      const host = hostMember(session);
      await this.membership.put(room.id, host);
      return host;
    }
    return null;
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
   * rank, ties share) and records them, idempotent by `gameId`. Returns `recorded` the first time,
   * `duplicate` on a retry.
   *
   * The room deliberately STAYS `running` on complete so the finale/game-over screen persists on
   * every device until the host explicitly returns to the lobby (WS7). The finale is the terminal
   * state; nothing must auto-advance off it. The host's `exit` control (see {@link control}) is the
   * one path that flips the room back to `lobby` - tearing the engine session down and letting the
   * host start another game (allowance is re-checked at the next start). Auto-flipping here would
   * make the poll-driven web clients drop out of the finale a beat after it appeared.
   */
  async recordGameComplete(report: GameCompleteReport): Promise<'recorded' | 'duplicate'> {
    const room = await this.repo.findById(report.room);
    if (!room) {
      throw new RoomError('not_found', 'Unknown room for game-complete report.');
    }
    const awards = standingsToStars(report.standings);
    const recorded = await this.repo.recordGame({
      gameId: report.gameId,
      roomId: room.id,
      game: report.game,
      standings: report.standings,
      stars: awards,
    });
    if (recorded) {
      // Record per-account play history (spec 0027) so a profile can total stars and list games.
      // Only on the first record (not a duplicate report), and the plays store is itself idempotent
      // by (accountId, gameId), so a retry never double-counts. Map each standing's public playerId
      // -> the room member's accountId; anonymous members have no account and are simply not recorded.
      const members = await this.membership.list(room.id);
      const accountByPlayer = new Map(
        members.filter((m) => m.accountId).map((m) => [m.playerId, m.accountId as string]),
      );
      const plays: RoomGamePlay[] = awards.flatMap((award) => {
        const accountId = accountByPlayer.get(award.player);
        return accountId
          ? [
              {
                accountId,
                gameId: report.gameId,
                game: report.game,
                rank: award.rank,
                stars: award.stars,
              },
            ]
          : [];
      });
      if (plays.length > 0) {
        await this.plays.recordPlays(plays);
      }
      // The room stays `running` so the finale persists until the host exits (WS7); do NOT flip to
      // lobby here.
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

/** Normalize a requested mode to a known value, defaulting to `interactive` (spec 0050). */
function normalizeMode(mode: Mode | undefined): Mode {
  return mode === 'remote' ? 'remote' : mode === 'viewer' ? 'viewer' : 'interactive';
}

/** True for the PLAYING modes that fill the roster and count toward a game's player limits. */
function isPlayingMode(mode: Mode): boolean {
  return mode === 'interactive' || mode === 'remote';
}

/**
 * Clamp a desired mode to a game's player maximum (spec 0050): a playing mode is downgraded to
 * `viewer` when the room already holds `max` playing members (excluding this session, so a rejoin
 * that keeps an already-counted seat is not double-counted). `viewer` is never clamped.
 */
function clampToMax(
  desired: Mode,
  room: Room,
  members: readonly RoomMember[],
  sessionId: string,
): Mode {
  if (!isPlayingMode(desired)) return desired;
  const { max } = playerLimits(room.selectedGame ?? '');
  const othersPlaying = playingCount(members.filter((m) => m.sessionId !== sessionId));
  return othersPlaying >= max ? 'viewer' : desired;
}

/**
 * Map room members to the engine's handoff players. Only PLAYING members (interactive + remote) go;
 * viewers watch and never fill the roster (spec 0050). The host is a playing member with
 * `isHost: true`, so it is intentionally included and plays like any other - this is what puts the
 * host in the engine roster, the leaderboard, and the final standings. The roster is keyed by the
 * public `playerId` (not the httpOnly `sessionId`), so a non-host browser that only ever learns its
 * `playerId` can `join` the engine and match its slot.
 */
function toHandoffPlayers(members: readonly RoomMember[]): HandoffPlayer[] {
  return members.filter(isPlaying).map((member) => ({
    player: member.playerId,
    nickname: member.nickname,
    // Carry host identity so the engine can auto-pause while the host is disconnected (0014).
    isHost: member.isHost,
  }));
}
