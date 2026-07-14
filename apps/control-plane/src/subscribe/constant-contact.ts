/**
 * The pure, I/O-free Constant Contact (CTCT) core for the subscribe endpoint (spec 0047): the OAuth
 * refresh-token -> access-token exchange, an in-memory access-token cache with a 60s skew, the
 * `sign_up_form` contact create, and a single-retry self-heal on a stale-token 401. Ported from the
 * sibling rogueoak site (`src/lib/subscribe.ts`), trimmed to branchout's single "Branch Out" list.
 *
 * No secrets live here: the client id, refresh token, and list id are read from config in the route
 * and passed in. `fetch` and `now` are injectable so the network and clock are mocked in tests - the
 * same dependency-injection shape the rest of the control-plane uses (an injected clock for the
 * rate limiter, an injected fetch for the engine client).
 */

import { type NameParts, splitName } from './validate';

// CTCT v3 endpoints. The token endpoint is the device-flow app's public-client token exchange (no
// client secret); `sign_up_form` is create-or-update, so a repeat email succeeds rather than erroring.
const TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token';
const SIGNUP_URL = 'https://api.cc.email/v3/contacts/sign_up_form';

// Refresh a bit before the token actually expires so an in-flight request never races the boundary
// and 401s.
const EXPIRY_SKEW_SEC = 60;

// Bound the upstream calls so a stalled CTCT server cannot hang a request indefinitely.
const UPSTREAM_TIMEOUT_MS = 10_000;

/** A Constant Contact `sign_up_form` request body. */
export type SignUpPayload = {
  email_address: string;
  create_source: 'Contact';
  list_memberships: string[];
  first_name?: string;
  last_name?: string;
};

/**
 * Shape a validated email into a CTCT `sign_up_form` body. `create_source: "Contact"` marks it a
 * visitor self-signup. The list ids come from the caller (config), never hard-coded. `sign_up_form`
 * is additive, so listing a membership never removes the contact's other lists. Optional
 * `first_name`/`last_name` are added ONLY when present, so a nameless signup produces the same payload.
 */
export function buildSignUpPayloadFor(
  email: string,
  listIds: string[],
  nameParts: NameParts = {},
): SignUpPayload {
  const payload: SignUpPayload = {
    email_address: email,
    create_source: 'Contact',
    list_memberships: listIds,
  };
  if (nameParts.firstName) {
    payload.first_name = nameParts.firstName;
  }
  if (nameParts.lastName) {
    payload.last_name = nameParts.lastName;
  }
  return payload;
}

/**
 * Exchange the long-lived (non-rotating) refresh token for a bearer access token. Public client, so
 * no client secret is sent. Throws on a non-2xx. `fetchImpl` is injectable for tests.
 */
export async function refreshAccessToken(
  { clientId, refreshToken }: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Status only - never fold the response body into the error (the route logs thrown errors and a
    // CTCT error body can echo submitted data).
    throw new Error(`Constant Contact token endpoint responded ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (!json || typeof json.access_token !== 'string') {
    throw new Error('Constant Contact token response missing access_token');
  }
  return {
    accessToken: json.access_token,
    // Default to 24h if the field is absent, minus the skew applied by the cache.
    expiresInSec: typeof json.expires_in === 'number' ? json.expires_in : 86_400,
  };
}

/** An HTTP error carrying the upstream status, so callers can branch on it (e.g. a 401 self-heal). */
type StatusError = Error & { status?: number };

/**
 * Add (or update) a contact on the target list(s) via `sign_up_form`, opting them in. Throws a
 * status-carrying error on a non-2xx (never the response body - a 4xx body can echo the submitted
 * email, and the route logs thrown errors). `fetchImpl` is injectable for tests.
 */
export async function addContactToList(
  {
    accessToken,
    email,
    listIds,
    nameParts,
  }: {
    accessToken: string;
    email: string;
    listIds: string[];
    nameParts?: NameParts;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(SIGNUP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildSignUpPayloadFor(email, listIds, nameParts)),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err: StatusError = new Error(`Constant Contact sign_up_form responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

/** The in-memory access-token cache returned by {@link createTokenCache}. */
export type TokenCache = {
  getAccessToken(
    creds: { clientId: string; refreshToken: string },
    fetchImpl?: typeof fetch,
  ): Promise<string>;
  /** Drop any cached token (test reset, or a stale-token self-heal). */
  clear(): void;
};

/**
 * A tiny in-memory access-token cache. Mints a token on the first call, then reuses it until shortly
 * before expiry, so a burst of submits does not hammer the auth server. Safe because the refresh token
 * is non-rotating - a refresh yields a new access token but the same refresh token, so there is nothing
 * to persist. Single-process by design (module-scoped in `index.ts`); a restart just re-mints. `now`
 * is injectable so expiry is unit-testable without a real clock.
 *
 * @param now - returns epoch ms
 */
export function createTokenCache(now: () => number = Date.now): TokenCache {
  let cached: { token: string; expiresAtMs: number } | null = null;
  // Memoize the in-flight refresh so a cold-cache burst shares ONE mint instead of each concurrent
  // caller hitting the auth server. Cleared in `finally` so a failed mint does not wedge the cache.
  let inflight: Promise<string> | null = null;
  return {
    getAccessToken(
      creds: { clientId: string; refreshToken: string },
      fetchImpl: typeof fetch = fetch,
    ): Promise<string> {
      if (cached && now() < cached.expiresAtMs) {
        return Promise.resolve(cached.token);
      }
      if (!inflight) {
        inflight = refreshAccessToken(creds, fetchImpl)
          .then(({ accessToken, expiresInSec }) => {
            cached = {
              token: accessToken,
              expiresAtMs: now() + (expiresInSec - EXPIRY_SKEW_SEC) * 1000,
            };
            return accessToken;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    clear() {
      cached = null;
    },
  };
}

/** Credentials + list config for a subscription write. */
export type ContactWriteArgs = {
  email: string;
  name?: string;
  clientId: string;
  refreshToken: string;
  listIds: string[];
};

/**
 * Run a token-authenticated CTCT write, self-healing ONCE on a stale token. A cached access token can
 * be invalidated upstream before its computed TTL (revocation, clock skew beyond 60s, an early CTCT
 * expiry). Rather than failing every request until the process restarts, on a 401 we drop the stale
 * token, mint a fresh one, and retry the operation a single time.
 */
async function withFreshTokenRetry(
  creds: { clientId: string; refreshToken: string },
  cache: TokenCache,
  fetchImpl: typeof fetch,
  op: (accessToken: string) => Promise<void>,
): Promise<void> {
  const accessToken = await cache.getAccessToken(creds, fetchImpl);
  try {
    await op(accessToken);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && (err as StatusError).status === 401) {
      cache.clear();
      const fresh = await cache.getAccessToken(creds, fetchImpl);
      await op(fresh);
      return;
    }
    throw err;
  }
}

/**
 * Orchestrate a subscription: get a (cached or fresh) access token, then add the contact to the given
 * list(s) via `sign_up_form` (opt-in). Throws on any non-2xx so the caller maps it to a generic error.
 * The `cache` is supplied by the caller (module-scoped) so it persists across requests; `fetchImpl` is
 * injectable for tests. An optional `name` is split into first/last name; an empty/absent name adds
 * nothing to the payload.
 */
export async function submitSubscription(
  { email, name, clientId, refreshToken, listIds }: ContactWriteArgs,
  { fetchImpl = fetch, cache }: { fetchImpl?: typeof fetch; cache: TokenCache },
): Promise<void> {
  const nameParts = splitName(name);
  await withFreshTokenRetry({ clientId, refreshToken }, cache, fetchImpl, (accessToken) =>
    addContactToList({ accessToken, email, listIds, nameParts }, fetchImpl),
  );
}
