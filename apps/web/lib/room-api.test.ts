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
  it('creates a room with the session cookie and returns the room view', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, body: { room } });
    const result = await createRoom();
    expect(result.code).toBe('ABC12');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rooms'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('joins a room by code with role, nickname, and mode in the body', async () => {
    const fetchMock = mockFetch({ ok: true, body: { room } });
    await joinRoom('ABC12', { role: 'player', nickname: 'Ada', mode: 'interactive' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      role: 'player',
      nickname: 'Ada',
      mode: 'interactive',
    });
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
      body: { members: [{ role: 'host', nickname: 'Ada', connected: true }] },
    });
    const members = await listMembers('ABC12');
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('host');
  });

  it('sends the advance control action (typed for the coming control-plane proxy)', async () => {
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
