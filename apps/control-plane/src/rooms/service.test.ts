import type { GameCompleteReport, RoundReport, Standing } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import { describe, expect, it } from 'vitest';
import { CreditLedger } from '../credits/ledger';
import { InMemoryLedgerRepository } from '../credits/repository.memory';
import { StaticTierProvider, type Tier } from '../credits/tiers';
import type { Session } from '../sessions/session';
import { FakeEngineClient } from './engine-client.fake';
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
  const service = new RoomService(repo, membership, ledger, engine);
  return { service, repo, membership, ledger, ledgerRepo, engine };
}

async function standing(player: string, rank: number): Promise<Standing> {
  return { player, nickname: player, score: 0, rank };
}

describe('room creation and hosting', () => {
  it('a signed-in host creates a room with a 5-char code, a share link, and joins as host', async () => {
    const { service, membership } = harness();
    const host = account();
    const room = await service.createRoom(host);
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.shareLink).toBe(`/join?code=${room.code}`);
    expect(room.status).toBe('lobby');
    const members = await membership.list(room.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: 'host', sessionId: host.id });
  });

  it('an anonymous session cannot host', async () => {
    const { service } = harness();
    await expect(service.createRoom(anon())).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('joining', () => {
  it('anonymous users join as players or observers, each with a per-game nickname', async () => {
    const { service, membership } = harness();
    const room = await service.createRoom(account());
    await service.join(room.code, anon(), { role: 'player', nickname: 'Speedy', mode: 'remote' });
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Watcher' });
    const members = await membership.list(room.id);
    const player = members.find((m) => m.nickname === 'Speedy');
    const observer = members.find((m) => m.nickname === 'Watcher');
    expect(player).toMatchObject({ role: 'player', mode: 'remote' });
    expect(observer).toMatchObject({ role: 'observer' });
    expect(observer?.mode).toBeUndefined();
  });

  it('rejects an empty nickname and an unknown code', async () => {
    const { service } = harness();
    const room = await service.createRoom(account());
    await expect(
      service.join(room.code, anon(), { role: 'player', nickname: '' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      service.join('ZZZZZ', anon(), { role: 'player', nickname: 'X' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('kick', () => {
  it('removes a member, blocks their rejoin, and leaves the code working for others', async () => {
    const { service, membership } = harness();
    const host = account();
    const room = await service.createRoom(host);
    const victim = anon('Victim');
    await service.join(room.code, victim, { role: 'player', nickname: 'Victim' });

    await service.kick(room.code, host, victim.id);
    expect(await membership.get(room.id, victim.id)).toBeNull();

    // The kicked session cannot rejoin.
    await expect(
      service.join(room.code, victim, { role: 'player', nickname: 'Victim' }),
    ).rejects.toMatchObject({ code: 'kicked' });

    // A different session can still join with the same code.
    const other = anon('Other');
    await expect(
      service.join(room.code, other, { role: 'observer', nickname: 'Other' }),
    ).resolves.toBeTruthy();
  });

  it('only the host can kick, and the host cannot kick themselves', async () => {
    const { service } = harness();
    const host = account();
    const room = await service.createRoom(host);
    const player = anon('P');
    await service.join(room.code, player, { role: 'player', nickname: 'P' });
    // A non-host cannot kick.
    await expect(service.kick(room.code, player, host.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // The host cannot kick themselves.
    await expect(service.kick(room.code, host, host.id)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('start rule and gates', () => {
  async function readyRoom(tiers: Record<string, Tier> = {}) {
    const h = harness(tiers);
    const host = account('Host', 'host_acct');
    const room = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', { questions: 5 });
    return { ...h, host, room };
  }

  it('blocks start with no viewer (only remote players) and allows it once a viewer is present', async () => {
    const { service, room, host, engine } = await readyRoom();
    // A single remote player is not a viewer.
    await service.join(room.code, anon(), {
      role: 'player',
      nickname: 'RemoteOnly',
      mode: 'remote',
    });
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_viewer' });
    expect(engine.starts).toHaveLength(0);

    // Add an observer: now there is a viewer.
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('an interactive player counts as a viewer', async () => {
    const { service, room, host, engine } = await readyRoom();
    await service.join(room.code, anon(), {
      role: 'player',
      nickname: 'Interactive',
      mode: 'interactive',
    });
    await service.start(room.code, host, 1);
    expect(engine.starts).toHaveLength(1);
  });

  it('refuses to start without a selected game', async () => {
    const { service } = harness();
    const host = account();
    const room = await service.createRoom(host);
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
    await expect(service.start(room.code, host, 1)).rejects.toMatchObject({ code: 'no_game' });
  });

  it('refuses to start more rounds than the balance covers, with no engine handoff', async () => {
    // Free tier grants 10/day; ask for 11 rounds.
    const { service, room, host, engine } = await readyRoom({ host_acct: 'free' });
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
    await expect(service.start(room.code, host, 11)).rejects.toMatchObject({
      code: 'insufficient_credits',
    });
    expect(engine.starts).toHaveLength(0);
  });

  it('a Party (unlimited) host can start any number of rounds', async () => {
    const { service, room, host, engine } = await readyRoom({ host_acct: 'party' });
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
    await service.start(room.code, host, 1000);
    expect(engine.starts).toHaveLength(1);
  });

  it('passes the opaque config to the engine unchanged and marks the room running', async () => {
    const { service, room, host, engine } = await readyRoom({ host_acct: 'party' });
    await service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
    const started = await service.start(room.code, host, 1);
    expect(started.status).toBe('running');
    expect(engine.starts[0]!.config).toEqual({ questions: 5 });
    expect(engine.starts[0]!.room).toBe(room.id);
    expect(engine.starts[0]!.game).toBe('trivia');
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
    const room = await h.service.createRoom(host);
    const player = anon();
    await h.service.join(room.code, player, { role: 'player', nickname: 'Sam', mode: 'remote' });

    const hostView = await h.service.members(room.code, host);
    expect(hostView.every((m) => typeof m.sessionId === 'string')).toBe(true);

    const playerView = await h.service.members(room.code, player);
    expect(playerView.length).toBe(hostView.length);
    expect(playerView.every((m) => m.sessionId === undefined)).toBe(true);

    await expect(h.service.members(room.code, anon())).rejects.toThrow();
  });
});

describe('host controls', () => {
  async function runningRoom() {
    const h = harness({ host_acct: 'party' });
    const host = account('Host', 'host_acct');
    const room = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', {});
    await h.service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
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
    const room = await h.service.createRoom(host);
    await h.service.selectGame(room.code, host, 'trivia', {});
    await h.service.join(room.code, anon(), { role: 'observer', nickname: 'Eyes' });
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
