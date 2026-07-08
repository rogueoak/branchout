import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RoomApiError,
  controlGame,
  createRoom,
  fetchIdentity,
  joinRoom,
  listMembers,
  startAnonymousSession,
  startGame,
} from './room-api';

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const room = {
  id: 'r1',
  code: 'ABC12',
  shareLink: 'http://localhost/join?code=ABC12',
  status: 'lobby',
  selectedGame: null,
  hostAccountId: 'acct1',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('room-api', () => {
  it('creates a room as a bodyless POST with no JSON content-type', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, body: { room, playerId: 'pid_host' } });
    const result = await createRoom();
    expect(result.room.code).toBe('ABC12');
    // Create echoes the host's public engine identity so the host can connect without waiting on
    // the members list.
    expect(result.playerId).toBe('pid_host');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/rooms');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // No body, and crucially NO `content-type: application/json` - Fastify rejects an
    // empty body with that content-type (FST_ERR_CTP_EMPTY_JSON_BODY), which 400d createRoom.
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('joins a room by code and returns the caller playerId', async () => {
    const fetchMock = mockFetch({ ok: true, body: { room, playerId: 'pid_123' } });
    const result = await joinRoom('ABC12', {
      role: 'player',
      nickname: 'Ada',
      mode: 'interactive',
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    // A bodied POST does declare the JSON content-type.
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      role: 'player',
      nickname: 'Ada',
      mode: 'interactive',
    });
    // The engine identity a non-host device needs to connect flows back on join.
    expect(result.playerId).toBe('pid_123');
    expect(result.room.code).toBe('ABC12');
  });

  it('maps a control-plane error body to a RoomApiError carrying the code', async () => {
    mockFetch({
      ok: false,
      status: 402,
      body: { error: 'Not enough credits.', code: 'insufficient_credits' },
    });
    await expect(startGame('ABC12', 10)).rejects.toMatchObject({
      status: 402,
      code: 'insufficient_credits',
      message: 'Not enough credits.',
    });
  });

  it('surfaces a network failure as a RoomApiError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRoom()).rejects.toBeInstanceOf(RoomApiError);
  });

  it('returns the members list', async () => {
    mockFetch({
      ok: true,
      body: {
        members: [
          { role: 'player', isHost: true, mode: 'interactive', nickname: 'Ada', connected: true },
        ],
      },
    });
    const members = await listMembers('ABC12');
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('player');
    expect(members[0]!.isHost).toBe(true);
  });

  it('sends the advance control action to the control-plane proxy', async () => {
    const fetchMock = mockFetch({ ok: true, body: { room } });
    await controlGame('ABC12', 'advance');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/rooms/ABC12/control');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'advance' });
  });

  it('maps an account identity to its nickname', async () => {
    mockFetch({
      ok: true,
      body: { kind: 'account', account: { nickname: 'Ada', gamerTag: 'AdaX' } },
    });
    expect(await fetchIdentity()).toEqual({ kind: 'account', displayName: 'Ada' });
  });

  it('falls back to the gamer tag when an account has no nickname', async () => {
    mockFetch({ ok: true, body: { kind: 'account', account: { gamerTag: 'AdaX' } } });
    expect(await fetchIdentity()).toEqual({ kind: 'account', displayName: 'AdaX' });
  });

  it('maps an anonymous identity to its display name', async () => {
    mockFetch({ ok: true, body: { kind: 'anonymous', displayName: 'Guest' } });
    expect(await fetchIdentity()).toEqual({ kind: 'anonymous', displayName: 'Guest' });
  });

  it('reports an unauthenticated identity', async () => {
    mockFetch({ ok: true, body: { kind: 'unauthenticated' } });
    expect(await fetchIdentity()).toEqual({ kind: 'unauthenticated', displayName: null });
  });

  it('mints an anonymous session with the code and display name', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 201,
      body: { kind: 'anonymous', displayName: 'Guest' },
    });
    await startAnonymousSession('ABC12', 'Guest');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/auth/anonymous');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'ABC12', displayName: 'Guest' });
  });
});
