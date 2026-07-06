// A typed browser client over the control-plane's room endpoints (spec 0006). Every call carries
// the session cookie (`credentials: 'include'`) and maps a control-plane error body
// (`{ error, code }`) to a thrown {@link RoomApiError} the UI can show verbatim. The control-plane
// is the authority for every rule here (host-only actions, the start gates); this module is the
// transport, not a second copy of the rules.

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

/** A member's role in a room. */
export type Role = 'host' | 'player' | 'observer';

/** A player's mode; observers and the host have none. */
export type Mode = 'interactive' | 'remote';

/** A room as the control-plane returns it. */
export interface RoomView {
  id: string;
  code: string;
  shareLink: string;
  status: 'lobby' | 'running' | string;
  selectedGame: string | null;
  hostAccountId: string;
}

/** One member of a room. `sessionId` is present only when the caller is the host. */
export interface RoomMember {
  sessionId?: string;
  accountId?: string;
  role: Role;
  mode?: Mode;
  nickname: string;
  connected: boolean;
}

/** A control-plane error with the stable code the UI branches on (e.g. gate reasons). */
export class RoomApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'RoomApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CONTROL_PLANE_URL}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    throw new RoomApiError(0, null, 'Could not reach the server. Check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong.';
    const code = typeof body.code === 'string' ? body.code : null;
    throw new RoomApiError(res.status, code, message);
  }
  return body as T;
}

/** The caller's identity, as `/auth/me` reports it. */
export interface Identity {
  kind: 'account' | 'anonymous' | 'unauthenticated';
  /** A display name to seed the per-game nickname, when the session has one. */
  displayName: string | null;
}

/** Read the current session's identity (used to seed nicknames and gate host-only actions). */
export async function fetchIdentity(): Promise<Identity> {
  const body = await request<{
    kind?: string;
    displayName?: string;
    account?: { nickname?: string; gamerTag?: string };
  }>('/auth/me', { method: 'GET' });
  if (body.kind === 'account') {
    return {
      kind: 'account',
      displayName: body.account?.nickname ?? body.account?.gamerTag ?? null,
    };
  }
  if (body.kind === 'anonymous') {
    return { kind: 'anonymous', displayName: body.displayName ?? null };
  }
  return { kind: 'unauthenticated', displayName: null };
}

/** Mint an anonymous session for a join-by-code player (sets the session cookie). */
export async function startAnonymousSession(code: string, displayName: string): Promise<void> {
  await request('/auth/anonymous', {
    method: 'POST',
    body: JSON.stringify({ code, displayName }),
  });
}

/** Host creates a room; returns the room with its share link. */
export async function createRoom(): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>('/rooms', { method: 'POST' });
  return room;
}

/** Join a room by code as a player or observer, with a per-game nickname and (for a player) mode. */
export async function joinRoom(
  code: string,
  input: { role: Role; nickname: string; mode?: Mode },
): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return room;
}

/** A player switches interactive/remote mode. */
export async function setMode(code: string, mode: Mode): Promise<void> {
  await request(`/rooms/${encodeURIComponent(code)}/mode`, {
    method: 'PATCH',
    body: JSON.stringify({ mode }),
  });
}

/** Host selects a game and its opaque config (passed through to the engine unchanged). */
export async function selectGame(code: string, game: string, config: unknown): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}/select`, {
    method: 'POST',
    body: JSON.stringify({ game, config }),
  });
  return room;
}

/** Host starts the selected game for `rounds` rounds (re-gated server-side on viewer + credits). */
export async function startGame(code: string, rounds: number): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}/start`, {
    method: 'POST',
    body: JSON.stringify({ rounds }),
  });
  return room;
}

/**
 * Host control: advance, pause, restart, or exit (exit returns the room to the lobby). `advance` is
 * a valid engine action but the control-plane's browser route does not yet proxy it - see
 * docs/feedback/0010-web-client-integration-gaps.md; sending it today returns a 400 until the
 * allow-list adds it. It is typed here so the client is correct the moment that lands.
 */
export async function controlGame(
  code: string,
  action: 'advance' | 'pause' | 'restart' | 'exit',
): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}/control`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  return room;
}

/** Host removes a member by their session id (they cannot rejoin on the same session). */
export async function kickMember(code: string, sessionId: string): Promise<void> {
  await request(`/rooms/${encodeURIComponent(code)}/kick`, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

/** List a room's members (caller must be a member; only the host sees session ids). */
export async function listMembers(code: string): Promise<RoomMember[]> {
  const { members } = await request<{ members: RoomMember[] }>(
    `/rooms/${encodeURIComponent(code)}/members`,
    { method: 'GET' },
  );
  return members;
}
