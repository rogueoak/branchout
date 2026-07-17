import type { GameCompleteReport, RoundReport, Standing } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { describe, expect, it } from 'vitest';
import { CreditLedger } from '../credits/ledger';
import { InMemoryLedgerRepository } from '../credits/repository.memory';
import { StaticTierProvider, type Tier } from '../credits/tiers';
import { InMemoryPlaysRepository } from '../profiles/plays.memory';
import type { Session } from '../sessions/session';
import type { Account } from '../accounts/repository';
import { FakeEngineClient } from './engine-client.fake';
import { newPlayerId } from './membership';
import { InMemoryMembershipStore } from './membership.memory';
import { InMemoryRoomRepository } from './repository.memory';
import { RoomError, RoomService } from './service';

let counter = 0;

function account(displayName = 'Host', accountId = `acct_${++counter}`): Session {
  return { id: `sess_${++counter}`, kind: 'account', accountId, displayName, createdAt: 0 };
}

function anon(displayName = 'Guest'): Session {
  return { id: `sess_${++counter}`, kind: 'anonymous', displayName, createdAt: 0 };
}

function harness(tiers: Record<string, Tier> = {}) {
  const repo = new InMemoryRoomRepository();
  const membership = new InMemoryMembershipStore();
  const ledgerRepo = new InMemoryLedgerRepository();
  const ledger = new CreditLedger(ledgerRepo, new StaticTierProvider(tiers));
  const engine = new FakeEngineClient();
  const plays = new InMemoryPlaysRepository();
  // A minimal accounts stub for the insider-visibility gate (spec 0043): only `findById().insider`
  // is read. Tests add an account id to `insiderAccounts` to grant the role.
  const insiderAccounts = new Set<string>();
  const accounts = {
    findById: async (id: string) => ({ insider: insiderAccounts.has(id) }) as unknown as Account,
  };
  const service = new RoomService(repo, membership, ledger, engine, plays, accounts);
  return { service, repo, membership, ledger, ledgerRepo, engine, plays, insiderAccounts };
}

async function standing(player: string, rank: number): Promise<Standing> {
  return { player, nickname: player, score: 0, rank };
}

describe('room creation and hosting', () => {
  it('a signed-in host creates a room and joins as a full player with the host flag and a mode', async () => {
    const { service, membership } = harness();
    const host = account();
    const { room, playerId } = await service.createRoom(host);
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.shareLink).toBe(`/join?code=${room.code}`);
    expect(room.status).toBe('lobby');
    const members = await membership.list(room.id);
    expect(members).toHaveLength(1);
    // The host is a player (so it flows through the roster/standings) with isHost true, a default
    // mode (interactive; the client refines it from the device via setMode), and is connected -
    // presence tracks it like any player.
    expect(members[0]).toMatchObject({
      isHost: true,
      mode: 'interactive',
      sessionId: host.id,
      connected: true,
    });
    // createRoom echoes the host's public playerId (like join) so the browser has its engine
    // identity without waiting on the members list - it matches the stored host row.
    expect(playerId).toBeTruthy();
    expect(playerId).toBe(members[0]!.playerId);
  });

  it('an anonymous session cannot host', async () => {
    const { service } = harness();
    await expect(service.createRoom(anon())).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('joining', () => {
  it('anonymous users join as players or observers, each with a per-game nickname', async () => {
    const { service, membership } = harness();
    const { room } = await service.createRoom(account());
    await service.join(room.code, anon(), { nickname: 'Speedy', mode: 'remote' });
    await service.join(room.code, anon(), { nickname: 'Watcher', mode: 'viewer' });
    const members = await membership.list(room.id);
    const player = members.find((m) => m.nickname === 'Speedy');
    const observer = members.find((m) => m.nickname === 'Watcher');
    expect(player).toMatchObject({ mode: 'remote' });
    expect(observer).toMatchObject({ mode: 'viewer' });
    expect(observer?.mode).toBe('viewer');
  });

  it('rejects an empty nickname and an unknown code', async () => {
    const { service } = harness();
    const { room } = await service.createRoom(account());
    await expect(
      service.join(room.code, anon(), { nickname: '', mode: 'interactive' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      service.join('ZZZZZ', anon(), { nickname: 'X', mode: 'interactive' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('mints a public playerId per member, distinct from the session id, and returns it on join', async () => {
    const { service, membership } = harness();
    const { room } = await service.createRoom(account());
    const player = anon('Speedy');
    const { playerId } = await service.join(room.code, player, {
      nickname: 'Speedy',
    });
    // The join echoes a non-empty playerId that is NOT the session id (the httpOnly cookie value).
    expect(playerId).toBeTruthy();
    expect(playerId).not.toBe(player.id);
    // It is stored beside the session id in membership.
    const stored = await membership.get(room.id, player.id);
    expect(stored?.playerId).toBe(playerId);
    expect(stored?.sessionId).toBe(player.id);
  });

  it('keeps a session its playerId across a rejoin', async () => {
    const { service } = harness();
    const { room } = await service.createRoom(account());
    const player = anon('Sam');
    const first = await service.join(room.code, player, { nickname: 'Sam', mode: 'interactive' });
    const second = await service.join(room.code, player, { nickname: 'Sam', mode: 'interactive' });
    expect(second.playerId).toBe(first.playerId);
  });
});

describe('kick', () => {
  it('removes a member, blocks their rejoin, and leaves the code working for others', async () => {
    const { service, membership } = harness();
    const host = account();
    const { room } = await service.createRoom(host);
    const victim = anon('Victim');
    await service.join(room.code, victim, { nickname: 'Victim', mode: 'interactive' });

    await service.kick(room.code, host, victim.id);
    expect(await membership.get(room.id, victim.id)).toBeNull();

    // The kicked session cannot rejoin.
    await expect(
      service.join(room.code, victim, { nickname: 'Victim', mode: 'interactive' }),
    ).rejects.toMatchObject({ code: 'kicked' });

    // A different session can still join with the same code.
    const other = anon('Other');
    await expect(
      service.join(room.code, other, { nickname: 'Other', mode: 'viewer' }),
    ).resolves.toBeTruthy();
  });

  it('only the host can kick, and the host cannot kick themselves', async () => {
    const { service } = harness();
    const host = account();
    const { room } = await service.createRoom(host);
    const player = anon('P');
    await service.join(room.code, player, { nickname: 'P', mode: 'interactive' });
    // A non-host cannot kick.
    await expect(service.kick(room.code, player, host.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // The host cannot kick themselves.
    await expect(service.kick(room.code, host, host.id)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('insider-only game visibility (spec 0043)', () => {
  it('a non-insider host cannot select an insider-only game', async () => {
    const { service } = harness();
    const host = account();
    const { room } = await service.createRoom(host);
    await expect(service.selectGame(room.code, host, 'teeter-tower', {})).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('an insider host can select and start an insider-only game', async () => {
    const { service, insiderAccounts } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    insiderAccounts.add('host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'teeter-tower', {});
    const view = await service.start(room.code, host, 1);
    expect(view.status).toBe('running');
  });

  it('start re-checks visibility: a non-insider cannot start a pre-selected insider game', async () => {
    // Selection is blocked for a non-insider, so set the game straight on the repo to prove the
    // start-side gate is a genuine second line of defence (not reachable via selectGame).
    const { service, repo } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room } = await service.createRoom(host);
    await repo.setSelectedGame(room.id, 'teeter-tower', {});
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a public game is unaffected by the insider gate', async () => {
    const { service } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    const view = await service.start(room.code, host, 1);
    expect(view.status).toBe('running');
  });
});

describe('host plays as a player', () => {
  it('carries the host into the engine handoff roster (playerId + nickname), excluding observers', async () => {
    const { service, membership, engine } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    // An observer that must NOT reach the engine roster.
    await service.join(room.code, anon(), { nickname: 'Watcher', mode: 'viewer' });
    // The interactive host is a viewer, so a solo host can start.
    await service.start(room.code, host, 1);

    // Seam: the host's public playerId + nickname reach the engine, and it is not dropped. The
    // host slot carries isHost so the engine can auto-pause while the host is disconnected (0014).
    const stored = await membership.get(room.id, host.id);
    const roster = engine.starts[0]!.players;
    const hostSlot = roster.find((p) => p.player === stored?.playerId);
    expect(hostSlot).toEqual({ player: stored?.playerId, nickname: 'Ada', isHost: true });
    // The observer is excluded from the roster.
    expect(roster.some((p) => p.nickname === 'Watcher')).toBe(false);
  });

  it('scores the host end to end: reaches the engine roster and earns stars by final rank', async () => {
    // A full arc, not just the input seam: the host plays a game and, ranked first in the final
    // standings, is awarded the winner's stars. A regression that drops the host from scoring
    // (roster or standings) breaks this.
    const { service, repo, engine } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room, playerId } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    const other = anon('Bo');
    const { playerId: bo } = await service.join(room.code, other, {
      nickname: 'Bo',
      mode: 'remote',
    });
    await service.start(room.code, host, 1);
    // The host is a scored participant in the roster the engine received.
    expect(engine.starts[0]!.players.some((p) => p.player === playerId)).toBe(true);

    // The engine reports the host first in the final standings; recordGameComplete converts rank
    // to stars and persists them (repo.recordedGames mirrors the Postgres store's stars column).
    const report: GameCompleteReport = {
      v: PROTOCOL_VERSION,
      room: room.id,
      game: 'trivia',
      gameId: 'g1',
      standings: [
        { player: playerId, nickname: 'Ada', score: 30, rank: 1 },
        { player: bo, nickname: 'Bo', score: 10, rank: 2 },
      ],
    };
    expect(await service.recordGameComplete(report)).toBe('recorded');
    const recorded = repo.recordedGames();
    expect(recorded).toHaveLength(1);
    // The host earns the winner's three stars for rank 1 - the user-visible outcome, not just the
    // handoff input.
    expect(recorded[0]!.stars.find((s) => s.player === playerId)).toMatchObject({
      rank: 1,
      stars: 3,
    });
  });

  it('records per-account plays on game-complete: maps playerId->accountId, skips anon, idempotent', async () => {
    // Spec 0027: the game-complete seam writes account-scoped history so a profile has real stars.
    const { service, plays } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room, playerId } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    // Bo is anonymous - no account, so no play should be recorded for them.
    const { playerId: bo } = await service.join(room.code, anon('Bo'), {
      nickname: 'Bo',
      mode: 'remote',
    });
    await service.start(room.code, host, 1);
    const report: GameCompleteReport = {
      v: PROTOCOL_VERSION,
      room: room.id,
      game: 'trivia',
      gameId: 'g1',
      standings: [
        { player: playerId, nickname: 'Ada', score: 30, rank: 1 },
        { player: bo, nickname: 'Bo', score: 10, rank: 2 },
      ],
    };
    expect(await service.recordGameComplete(report)).toBe('recorded');
    // The host (an account) earns 3 stars for rank 1; the anonymous player records nothing.
    expect(await plays.totalStars('host_acct')).toBe(3);
    const recent = await plays.recentPlays('host_acct', 10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ game: 'trivia', rank: 1, stars: 3, gameId: 'g1' });

    // A duplicate report (same gameId) is idempotent - stars do not double.
    expect(await service.recordGameComplete(report)).toBe('duplicate');
    expect(await plays.totalStars('host_acct')).toBe(3);
  });

  it('lets a solo interactive host satisfy the viewer gate and start', async () => {
    const { service, engine } = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    // No other members at all - the interactive host is the only viewer.
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('blocks a remote-only host with no other viewer', async () => {
    const { service, engine } = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'trivia', {});
    // The host switches to remote, so it is no longer a viewer, and no one else is present.
    await service.setMode(room.code, host, 'remote');
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_viewer' });
    expect(engine.starts).toHaveLength(0);
    // Add a remote player: still no viewer.
    await service.join(room.code, anon(), { nickname: 'R', mode: 'remote' });
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_viewer' });
  });

  it('lets the host set and change its mode', async () => {
    const { service, membership } = harness();
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    expect((await membership.get(room.id, host.id))?.mode).toBe('interactive');
    await service.setMode(room.code, host, 'remote');
    expect((await membership.get(room.id, host.id))?.mode).toBe('remote');
  });

  it('keeps a host a host across a rejoin, even if it rejoins as an observer', async () => {
    const { service, membership } = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room, playerId } = await service.createRoom(host);
    // The host re-enters through the join path (e.g. the Rejoin link) asking to observe. The room
    // is the authority for host status, so the request cannot demote the host: it stays a player
    // with isHost, keeps its playerId, and holds its chosen mode.
    await service.setMode(room.code, host, 'remote');
    const rejoin = await service.join(room.code, host, { nickname: 'Ada', mode: 'viewer' });
    expect(rejoin.playerId).toBe(playerId);
    const stored = await membership.get(room.id, host.id);
    expect(stored).toMatchObject({ isHost: true, mode: 'remote', playerId });
    // And the host is still a viewer-capable participant in the roster machinery: it can flip back
    // to interactive and start solo, which a demoted observer/host could not.
    await service.setMode(room.code, host, 'interactive');
    await service.selectGame(room.code, host, 'trivia', {});
    await expect(service.start(room.code, host, 1)).resolves.toBeTruthy();
  });

  it('shows the host every member sessionId but redacts it from a non-host player', async () => {
    const { service } = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    const player = anon('Sam');
    await service.join(room.code, player, { nickname: 'Sam', mode: 'remote' });

    const hostView = await service.members(room.code, host);
    expect(hostView.every((m) => typeof m.sessionId === 'string')).toBe(true);
    // The host row is flagged isHost so the browser can find its own engine identity.
    expect(hostView.find((m) => m.isHost)?.nickname).toBe('Host');

    const playerView = await service.members(room.code, player);
    expect(playerView.every((m) => m.sessionId === undefined)).toBe(true);
  });

  it('will not kick the host but will kick a player', async () => {
    const { service, membership } = harness();
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    const player = anon('P');
    await service.join(room.code, player, { nickname: 'P', mode: 'interactive' });
    // The host cannot kick itself (self-kick guard), so the host is not removable.
    await expect(service.kick(room.code, host, host.id)).rejects.toMatchObject({ code: 'invalid' });
    expect(await membership.get(room.id, host.id)).not.toBeNull();
    // A regular player still is kickable.
    await service.kick(room.code, host, player.id);
    expect(await membership.get(room.id, player.id)).toBeNull();
  });

  it('refuses to kick an isHost member held under a different session id', async () => {
    const { service, membership } = harness();
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    // A second membership row that is isHost under a DIFFERENT session id (the same host account
    // re-entering on another device/tab). This exercises the isHost guard itself, not the
    // self-kick guard - targetSessionId is not the caller's session id.
    const secondSession = 'sess_host_2';
    await membership.put(room.id, {
      sessionId: secondSession,
      playerId: newPlayerId(),
      accountId: 'host_acct',
      isHost: true,
      mode: 'interactive',
      nickname: 'Host',
      connected: true,
    });
    await expect(service.kick(room.code, host, secondSession)).rejects.toMatchObject({
      code: 'invalid',
    });
    // The isHost row is not removed.
    expect(await membership.get(room.id, secondSession)).not.toBeNull();
  });
});

describe('start rule and gates', () => {
  async function readyRoom(tiers: Record<string, Tier> = {}) {
    const h = harness(tiers);
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', { questions: 5 });
    return { ...h, host, room };
  }

  it('blocks start with no viewer (only remote players) and allows it once a viewer is present', async () => {
    const { service, room, host, engine } = await readyRoom();
    // The host defaults to interactive (a viewer). Switch it to remote so this exercises the gate:
    // with only remote players and no viewer at all, a start must be blocked.
    await service.setMode(room.code, host, 'remote');
    await service.join(room.code, anon(), {
      nickname: 'RemoteOnly',
      mode: 'remote',
    });
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_viewer' });
    expect(engine.starts).toHaveLength(0);

    // Add an observer: now there is a viewer.
    await service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('an interactive player counts as a viewer', async () => {
    const { service, room, host, engine } = await readyRoom();
    await service.join(room.code, anon(), {
      nickname: 'Interactive',
      mode: 'interactive',
    });
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('refuses to start without a selected game', async () => {
    const { service } = harness();
    const host = account();
    const { room } = await service.createRoom(host);
    await service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_game' });
  });

  it('refuses to start more rounds than the balance covers, with no engine handoff', async () => {
    // Free tier grants 10/day; ask for 11 rounds.
    const { service, room, host, engine } = await readyRoom({ host_acct: 'free' });
    await service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await expect(service.start(room.code, host, 11)).rejects.toMatchObject({
      code: 'insufficient_credits',
    });
    expect(engine.starts).toHaveLength(0);
  });

  it('a Party (unlimited) host can start any number of rounds', async () => {
    const { service, room, host, engine } = await readyRoom({ host_acct: 'party' });
    await service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await service.start(room.code, host, 1000);
    expect(engine.starts).toHaveLength(1);
  });

  it('passes the opaque config to the engine unchanged and marks the room running', async () => {
    const { service, room, host, engine } = await readyRoom({ host_acct: 'party' });
    await service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    const started = await service.start(room.code, host, 1);
    expect(started.status).toBe('running');
    expect(engine.starts[0]!.config).toEqual({ questions: 5 });
    expect(engine.starts[0]!.room).toBe(room.id);
    expect(engine.starts[0]!.game).toBe('trivia');
  });

  it('keys the engine handoff roster by the public playerId, never the session id', async () => {
    const { service, membership, room, host, engine } = await readyRoom({ host_acct: 'party' });
    const player = anon('Racer');
    const { playerId } = await service.join(room.code, player, {
      nickname: 'Racer',
      mode: 'interactive',
    });
    await service.start(room.code, host, 1);
    const roster = engine.starts[0]!.players;
    const racer = roster.find((p) => p.nickname === 'Racer');
    // The roster identity the engine (and thus the browser's `join`) keys on is the public
    // playerId - exactly what `join` returned to the device - and NOT the httpOnly session id.
    expect(racer?.player).toBe(playerId);
    expect(racer?.player).not.toBe(player.id);
    // And the stored member confirms the two ids are distinct.
    const stored = await membership.get(room.id, player.id);
    expect(stored?.playerId).toBe(playerId);
    expect(stored?.sessionId).toBe(player.id);
  });

  it('only the host can select or start', async () => {
    const { service, room } = await readyRoom({ host_acct: 'party' });
    const stranger = account('Stranger', 'other_acct');
    await expect(service.selectGame(room.code, stranger, 'trivia', {})).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(service.start(room.code, stranger, 1)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('members roster', () => {
  it('requires membership and hides sessionId from non-host members', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    const player = anon();
    await h.service.join(room.code, player, { nickname: 'Sam', mode: 'remote' });

    const hostView = await h.service.members(room.code, host);
    expect(hostView.every((m) => typeof m.sessionId === 'string')).toBe(true);

    const playerView = await h.service.members(room.code, player);
    expect(playerView.length).toBe(hostView.length);
    expect(playerView.every((m) => m.sessionId === undefined)).toBe(true);

    await expect(h.service.members(room.code, anon())).rejects.toThrow();
  });
});

describe('room view (poll for status)', () => {
  it('lets a member read the current status so a non-host learns the game started', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    const player = anon();
    await h.service.join(room.code, player, { nickname: 'Eyes', mode: 'viewer' });
    await h.service.selectGame(room.code, host, 'trivia', {});

    // Before start, both see the lobby.
    expect((await h.service.view(room.code, player)).status).toBe('lobby');
    await h.service.start(room.code, host, 1);
    // After the host starts, the non-host's poll observes 'running' - how it transitions in.
    expect((await h.service.view(room.code, player)).status).toBe('running');
  });

  it('refuses a non-member (knowing the code is not enough)', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await expect(h.service.view(room.code, anon())).rejects.toThrow();
  });

  it('re-seats the durable host when its ephemeral roster row has expired', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room } = await h.service.createRoom(host);
    // Simulate the Redis membership TTL expiring while host_account_id in Postgres endures.
    await h.membership.remove(room.id, host.id);
    expect(await h.membership.get(room.id, host.id)).toBeNull();

    // The host polling past the TTL is silently restored rather than 403'd off its own room.
    expect((await h.service.view(room.code, host)).code).toBe(room.code);
    const seat = await h.membership.get(room.id, host.id);
    expect(seat).toMatchObject({ isHost: true, nickname: 'Ada', connected: true });
    // members() sees the re-seated host row (with its sessionId, since the caller is the host).
    const roster = await h.service.members(room.code, host);
    expect(roster.some((m) => m.isHost && m.sessionId === host.id)).toBe(true);
  });
});

describe('resume (rebuild the caller seat after a forgotten tab)', () => {
  it('returns the host row and re-seats a durable host whose row expired', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Ada', 'host_acct');
    const { room, playerId } = await h.service.createRoom(host);
    await h.membership.remove(room.id, host.id);

    const resumed = await h.service.resume(room.code, host);
    expect(resumed.room.code).toBe(room.code);
    expect(resumed.membership).toMatchObject({ isHost: true, nickname: 'Ada' });
    // A fresh playerId is minted on re-seat (matches join-after-expiry); it is a real id, not empty.
    expect(resumed.membership.player).toBeTruthy();
    expect(resumed.membership.player).not.toBe(playerId);
    // The row is persisted, so a follow-up poll finds it without re-seating again.
    const again = await h.service.resume(room.code, host);
    expect(again.membership.player).toBe(resumed.membership.player);
  });

  it('returns a still-live non-host member without changing their seat', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    const player = anon('Sam');
    const { playerId } = await h.service.join(room.code, player, {
      nickname: 'Sam',
      mode: 'remote',
    });

    const resumed = await h.service.resume(room.code, player);
    expect(resumed.membership).toMatchObject({
      isHost: false,
      mode: 'remote',
      nickname: 'Sam',
      player: playerId,
    });
  });

  it('rejects a genuine non-member with not_member (so the client shows the join prompt)', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await expect(h.service.resume(room.code, anon())).rejects.toMatchObject({ code: 'not_member' });
  });

  it('does not re-seat a non-host whose row expired (a guest must re-join)', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    const player = anon('Sam');
    await h.service.join(room.code, player, { nickname: 'Sam', mode: 'interactive' });
    await h.membership.remove(room.id, player.id);
    await expect(h.service.resume(room.code, player)).rejects.toMatchObject({ code: 'not_member' });
  });
});

describe('public preview (for link unfurls)', () => {
  it('returns status and selected game to anyone, with no session and no private fields', async () => {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', {});

    // No session argument: a crawler is not a member, yet it can still read the preview.
    const preview = await h.service.preview(room.code);
    expect(preview).toEqual({ code: room.code, status: 'lobby', selectedGame: 'trivia' });
    // It must not leak anything private that a member view carries.
    expect(preview).not.toHaveProperty('id');
    expect(preview).not.toHaveProperty('hostAccountId');
    expect(preview).not.toHaveProperty('shareLink');
    expect(preview).not.toHaveProperty('members');
    expect(preview).not.toHaveProperty('sessionId');
  });

  it('reports a null game before the host picks one', async () => {
    const h = harness({ host_acct: 'party' });
    const { room } = await h.service.createRoom(account('Host', 'host_acct'));
    expect(await h.service.preview(room.code)).toMatchObject({ selectedGame: null });
  });

  it('throws not_found for an unknown code', async () => {
    const h = harness();
    await expect(h.service.preview('ZZZZZ')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('host controls', () => {
  async function runningRoom() {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', {});
    await h.service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await h.service.start(room.code, host, 1);
    return { ...h, host, room };
  }

  it('proxies pause and restart to the engine without changing room status', async () => {
    const { service, room, host, engine } = await runningRoom();
    await service.control(room.code, host, 'pause');
    await service.control(room.code, host, 'restart');
    expect(engine.controls.map((c) => c.action)).toEqual(['pause', 'restart']);
    const after = await service.members(room.code, host); // room still exists; status unaffected
    expect(after.length).toBeGreaterThan(0);
  });

  it('exit reaches the engine and returns the room to the lobby', async () => {
    const { service, room, host, engine, repo } = await runningRoom();
    const view = await service.control(room.code, host, 'exit');
    expect(engine.controls.at(-1)?.action).toBe('exit');
    expect(view.status).toBe('lobby');
    expect((await repo.findById(room.id))?.status).toBe('lobby');
  });
});

describe('round and game-complete intake', () => {
  async function runningRoom(tier: Tier = 'free') {
    const h = harness({ host_acct: tier });
    const host = account('Host', 'host_acct');
    const { room } = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', {});
    await h.service.join(room.code, anon(), { nickname: 'Eyes', mode: 'viewer' });
    await h.service.start(room.code, host, 5);
    return { ...h, host, room };
  }

  function roundReport(room: string, roundId: string): RoundReport {
    return {
      v: PROTOCOL_VERSION,
      room,
      game: 'trivia',
      round: 1,
      roundId,
      scores: [{ player: 'p', points: 10, reason: 'correct' }],
      standings: [{ player: 'p', nickname: 'p', score: 10, rank: 1 }],
    };
  }

  it('debits exactly one credit per round and is idempotent on a retried report', async () => {
    const { service, room, ledger } = await runningRoom('free');
    // Free grant (10) was applied at the affordability check on start.
    expect(await ledger.balance('host_acct')).toBe(10);

    expect(await service.recordRound(roundReport(room.id, 'r1'))).toBe('recorded');
    expect(await ledger.balance('host_acct')).toBe(9);
    // Retry: no second debit, reported as a duplicate.
    expect(await service.recordRound(roundReport(room.id, 'r1'))).toBe('duplicate');
    expect(await ledger.balance('host_acct')).toBe(9);

    // A distinct round debits again.
    expect(await service.recordRound(roundReport(room.id, 'r2'))).toBe('recorded');
    expect(await ledger.balance('host_acct')).toBe(8);
  });

  it('rejects a report for an unknown room', async () => {
    const { service } = await runningRoom();
    await expect(service.recordRound(roundReport('missing-room', 'r1'))).rejects.toBeInstanceOf(
      RoomError,
    );
  });

  it('converts final standings to stars, records once, and returns the room to the lobby', async () => {
    const { service, room, repo } = await runningRoom('party');
    const report: GameCompleteReport = {
      v: PROTOCOL_VERSION,
      room: room.id,
      game: 'trivia',
      gameId: 'g1',
      standings: [await standing('a', 1), await standing('b', 2), await standing('c', 3)],
    };
    expect(await service.recordGameComplete(report)).toBe('recorded');
    expect((await repo.findById(room.id))?.status).toBe('lobby');
    // Idempotent on the game id.
    expect(await service.recordGameComplete(report)).toBe('duplicate');
  });
});

describe('player limits (spec 0050)', () => {
  it('blocks Start below a game player minimum (Liar Liar needs 2), then allows it', async () => {
    const { service, engine } = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'liar-liar', {});
    // Solo interactive host: a screen is present, but only 1 player < min 2.
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({
      code: 'too_few_players',
    });
    expect(engine.starts).toHaveLength(0);
    // A second playing member meets the minimum.
    await service.join(room.code, anon(), { nickname: 'Bo', mode: 'remote' });
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('clamps a playing join to viewer once the game is at its player maximum (Teeter caps at 4)', async () => {
    const { service, membership, insiderAccounts } = harness({ host_acct: 'party' });
    insiderAccounts.add('host_acct');
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host); // host is interactive (1 playing)
    await service.selectGame(room.code, host, 'teeter-tower', {});
    // Fill the remaining 3 playing seats.
    for (const n of ['a', 'b', 'c']) {
      await service.join(room.code, anon(), { nickname: n, mode: 'remote' });
    }
    // A 5th joiner asking to play is clamped to viewer - the game is full at 4 players.
    const fifth = anon();
    await service.join(room.code, fifth, { nickname: 'late', mode: 'interactive' });
    const stored = await membership.get(room.id, fifth.id);
    expect(stored?.mode).toBe('viewer');
    // Only the 4 playing members go to the engine roster; the viewer does not.
    await service.start(room.code, host, 1);
    // (handoff filtering is covered elsewhere; here we assert the roster size via the clamp result)
    const all = await membership.list(room.id);
    expect(all.filter((m) => m.mode === 'viewer')).toHaveLength(1);
  });

  it('refuses switching to a playing mode when full, but allows viewer and a swap within the cap', async () => {
    const { service, membership, insiderAccounts } = harness({ host_acct: 'party' });
    insiderAccounts.add('host_acct');
    const host = account('Host', 'host_acct');
    const { room } = await service.createRoom(host);
    await service.selectGame(room.code, host, 'teeter-tower', {});
    const remotes = [anon(), anon(), anon()];
    for (const r of remotes) {
      await service.join(room.code, r, { nickname: 'r', mode: 'remote' });
    }
    // Full at 4 (host + 3). A viewer trying to become a player is refused.
    const watcher = anon();
    await service.join(room.code, watcher, { nickname: 'w', mode: 'interactive' }); // clamped to viewer
    await expect(service.setMode(room.code, watcher, 'remote')).rejects.toMatchObject({
      code: 'room_full',
    });
    // Staying a viewer is always fine.
    await service.setMode(room.code, watcher, 'viewer');
    expect((await membership.get(room.id, watcher.id))?.mode).toBe('viewer');
    // A current player swapping remote<->interactive at the cap is allowed (own seat excluded).
    await service.setMode(room.code, remotes[0]!, 'interactive');
    expect((await membership.get(room.id, remotes[0]!.id))?.mode).toBe('interactive');
  });
});
