// A typed browser client for the account/profile write surface (spec 0027): read the current
// identity, change nickname/avatar/visibility, and log out. Every call carries the session cookie
// and hits the `/v1` API (spec 0033). The control-plane is the authority; this is transport only.

import { V1_PREFIX } from '@branchout/protocol';

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

export type Visibility = 'public' | 'friends-only' | 'private';

/** The signed-in account as `/auth/me` reports it. */
export interface MeAccount {
  id: string;
  gamerTag: string;
  nickname: string;
  avatar: string;
  visibility: Visibility;
  /** Beta-tester entitlement (spec 0035): gates the "Insider game previews" entry point (spec 0039). */
  insider?: boolean;
}

export interface Me {
  kind: 'account' | 'anonymous' | 'unauthenticated';
  account?: MeAccount;
}

/** A control-plane error the account UI can show verbatim. */
export class AccountApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AccountApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body != null) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}${path}`, {
      credentials: 'include',
      ...init,
      headers,
    });
  } catch {
    throw new AccountApiError(0, 'Could not reach the server. Check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong.';
    throw new AccountApiError(res.status, message);
  }
  return body as T;
}

/** The current identity (used to hydrate the account page). */
export async function fetchMe(): Promise<Me> {
  return request<Me>('/auth/me', { method: 'GET' });
}

/** Change the display nickname. */
export async function setNickname(nickname: string): Promise<MeAccount> {
  const { account } = await request<{ account: MeAccount }>('/auth/nickname', {
    method: 'PATCH',
    body: JSON.stringify({ nickname }),
  });
  return account;
}

/** Pick an avatar from the set. */
export async function setAvatar(avatar: string): Promise<MeAccount> {
  const { account } = await request<{ account: MeAccount }>('/auth/avatar', {
    method: 'PATCH',
    body: JSON.stringify({ avatar }),
  });
  return account;
}

/** Set profile visibility. */
export async function setVisibility(visibility: Visibility): Promise<MeAccount> {
  const { account } = await request<{ account: MeAccount }>('/auth/visibility', {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
  return account;
}

/** Revoke the session server-side and clear the cookie. Idempotent. */
export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}
