// A typed browser client over the control-plane's room endpoints (spec 0006). Every call carries
// the session cookie (`credentials: 'include'`) and maps a control-plane error body
// (`{ error, code }`) to a thrown {@link RoomApiError} the UI can show verbatim. The control-plane
// is the authority for every rule here (host-only actions, the start gates); this module is the
// transport, not a second copy of the rules.

import { V1_PREFIX } from '@branchout/protocol';

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

/**
 * A member's mode (spec 0050): `viewer` watches only (a shared screen), `interactive` plays with the
 * game + controller on one screen, `remote` plays with a controller only. `interactive`/`remote` are
 * the playing modes; `viewer`/`interactive` are the display (screen-capable) modes. Every member has
 * one. The `isHost` flag on {@link RoomMember} carries the host privilege, independent of mode.
 */
export type Mode = 'viewer' | 'interactive' | 'remote';

/** The playing modes that count toward a game's player limits and fill the engine roster. */
export function isPlayingMode(mode: Mode): boolean {
  return mode === 'interactive' || mode === 'remote';
}

/** The display modes: a device that can show the game on a screen (a shared viewer or interactive). */
export function isDisplayMode(mode: Mode): boolean {
  return mode === 'viewer' || mode === 'interactive';
}

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
  /** The member's public engine identity (present on every row; the host reads its own from here). */
  playerId: string;
  accountId?: string;
  /** True for the room's host: a member that also holds the admin powers (controls, kick). */
  isHost: boolean;
  /** This member's mode (spec 0050): viewer, interactive, or remote. Always set. */
  mode: Mode;
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
  // Only declare a JSON content-type when there is actually a body. Fastify rejects an
  // empty body sent with `content-type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which 400s every bodyless POST (e.g. createRoom).
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body != null) {
    headers['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    // Every functional API is served under `/v1` (spec 0033); the version is applied once here so
    // the per-endpoint path strings below stay bare.
    res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}${path}`, {
      credentials: 'include',
      ...init,
      headers,
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

/** The room the caller created/joined, plus their own public engine `playerId` (used to join the
 * engine). Shared shape for both create and join. */
export interface JoinResult {
  room: RoomView;
  playerId: string;
}

/**
 * Host creates a room; returns the room with its share link and the host's own public engine
 * `playerId`. The host needs its `playerId` to connect to the engine, so - like `join` - `createRoom`
 * echoes it back, letting a host reload mid-game without being bounced to rejoin.
 */
export async function createRoom(): Promise<JoinResult> {
  const { room, playerId } = await request<JoinResult>('/rooms', { method: 'POST' });
  return { room, playerId };
}

/** Join a room by code with a per-game nickname and mode (viewer / interactive / remote). */
export async function joinRoom(
  code: string,
  input: { nickname: string; mode?: Mode },
): Promise<JoinResult> {
  const { room, playerId } = await request<JoinResult>(`/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { room, playerId };
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
 * Host control: advance, pause, restart, or exit (exit returns the room to the lobby). `advance`
 * steps the round lifecycle forward (the host-driven collecting -> reveal and leaderboard ->
 * next-round transitions); the control-plane route proxies it to the engine (spec 0012).
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

/**
 * Fetch the current room view (caller must be a member). Polled in the lobby so a non-host device
 * learns when the host starts the game (status -> running) or exits it back to the lobby - the
 * non-host never runs the host's start/control handler, so this is how it transitions.
 */
export async function getRoom(code: string): Promise<RoomView> {
  const { room } = await request<{ room: RoomView }>(`/rooms/${encodeURIComponent(code)}`, {
    method: 'GET',
  });
  return room;
}

/** The caller's own seat in a room, as `GET /rooms/:code/me` returns it: the room plus the fields
 * the client needs to rebuild its per-tab membership. `player` is the caller's public engine
 * `playerId`. */
export interface ResumeResult {
  room: RoomView;
  membership: {
    isHost: boolean;
    mode: Mode;
    nickname: string;
    player: string;
  };
}

/**
 * Rebuild the caller's seat after the tab forgot it (closed-tab `sessionStorage` is cleared). The
 * control-plane re-seats a durable host whose ephemeral roster row expired, so a returning host is
 * recovered here (feedback 0021); a genuine non-member throws `RoomApiError` with code `not_member`,
 * which the room page reads as "show the join prompt".
 */
export async function resumeRoom(code: string): Promise<ResumeResult> {
  return request<ResumeResult>(`/rooms/${encodeURIComponent(code)}/me`, { method: 'GET' });
}

/**
 * Fetch this device's short-lived engine-join auth token (spec 0064). The control-plane mints it
 * over the caller's OWN membership (session -> playerId), so it can only ever authenticate THIS
 * device as its own player - never another. The game client includes it in the engine `join` frame,
 * and the engine verifies it before honouring the join, which is what makes per-player secrecy
 * actually hold. Re-fetched on each (re)connect, since the token is deliberately short-lived.
 */
export async function fetchEngineToken(code: string): Promise<string> {
  const { token } = await request<{ token: string }>(
    `/rooms/${encodeURIComponent(code)}/engine-token`,
    { method: 'GET' },
  );
  return token;
}

/** List a room's members (caller must be a member; only the host sees session ids). */
export async function listMembers(code: string): Promise<RoomMember[]> {
  const { members } = await request<{ members: RoomMember[] }>(
    `/rooms/${encodeURIComponent(code)}/members`,
    { method: 'GET' },
  );
  return members;
}
