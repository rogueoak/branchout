import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RoomApiError,
  controlGame,
  createRoom,
  joinRoom,
  listMembers,
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
    const [, init] = fetchMock.mock.calls[0];
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
    expect(members[0].role).toBe('host');
  });

  it('sends the advance control action (typed for the coming control-plane proxy)', async () => {
    const fetchMock = mockFetch({ ok: true, body: { room } });
    await controlGame('ABC12', 'advance');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rooms/ABC12/control');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'advance' });
  });
});
