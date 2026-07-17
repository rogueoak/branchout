// Engine-join authentication token (spec 0064). The engine WebSocket `join` frame carries a
// client-supplied `player` id, and playerIds are PUBLIC (broadcast in every `state` frame), so the
// engine cannot tell a real player from an impersonator claiming another player's id. That voids the
// spec-0052 per-player secrecy guarantee: a participant could `join { player: <victim> }` and read
// the victim's `private:` channel. This module is the fix - a stateless, short-lived HMAC token that
// binds a connection to ONE authenticated `{room, game, player}`.
//
// The CONTROL-PLANE owns the private sessionId<->playerId mapping, so it MINTS the token over the
// caller's OWN membership (a device can only ever get a token for its own playerId, never another's).
// The ENGINE VERIFIES it on join. Both ends share this single module so mint and verify can never
// drift. The shared secret (`ENGINE_AUTH_SECRET`) is a server-only value present on both services.
//
// The token is `${payload}.${signature}` where payload is `${room}.${game}.${player}.${exp}` and the
// signature is base64url HMAC-SHA256 of that payload. It carries no secret itself (the ids are all
// public and `exp` is a timestamp); its only power is proving the control-plane vouched for the bind.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a freshly minted token is valid, in seconds. Short: it is fetched right before connecting
 * and a reconnect re-fetches, so a leaked token is useless within a couple of minutes. */
export const ENGINE_TOKEN_TTL_SECONDS = 120;

/** The authenticated identity a verified engine token attests. */
export interface EngineTokenClaims {
  room: string;
  game: string;
  player: string;
  /** Expiry as epoch SECONDS. */
  exp: number;
}

/** Join the claim fields into the signed payload. The order is fixed and shared by mint + verify. */
function payloadOf(room: string, game: string, player: string, exp: number): string {
  // The ids never contain a '.' (they are the engine's opaque ids), so '.' is an unambiguous
  // separator; the parser below splits from the right for the signature and rejects a wrong field
  // count, so a crafted id cannot smuggle extra segments.
  return `${room}.${game}.${player}.${exp}`;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Mint a token that authenticates `{room, game, player}` until `nowSeconds + ttlSeconds`. Called by
 * the control-plane over the caller's own membership. `now`/`ttl` are injectable so tests can mint an
 * already-expired token without waiting.
 */
export function mintEngineToken(
  claims: { room: string; game: string; player: string },
  secret: string,
  options: { nowSeconds?: number; ttlSeconds?: number } = {},
): string {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? ENGINE_TOKEN_TTL_SECONDS;
  const exp = now + ttl;
  const payload = payloadOf(claims.room, claims.game, claims.player, exp);
  return `${payload}.${sign(payload, secret)}`;
}

/** Why a token failed to verify, for a targeted rejection message. */
export type EngineTokenError = 'malformed' | 'bad_signature' | 'expired';

export type EngineTokenResult =
  { ok: true; claims: EngineTokenClaims } | { ok: false; error: EngineTokenError };

/**
 * Verify a token against the shared secret and the current time. Returns the attested claims on
 * success; the caller must still check the claims match the join it is authorising (same room/game
 * and, critically, `claims.player === join.player` - the token proves the control-plane vouched for
 * THAT player, and the engine must bind the socket to it, not to a mismatched `player` field).
 *
 * The signature compare is constant-time; a length mismatch short-circuits to a plain false (a wrong
 * length cannot be a valid signature) so `timingSafeEqual` never throws on mismatched buffers.
 */
export function verifyEngineToken(
  token: string,
  secret: string,
  options: { nowSeconds?: number } = {},
): EngineTokenResult {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return { ok: false, error: 'malformed' };
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const parts = payload.split('.');
  if (parts.length !== 4) return { ok: false, error: 'malformed' };
  const [room, game, player, expRaw] = parts;
  const exp = Number(expRaw);
  if (!room || !game || !player || !Number.isInteger(exp)) {
    return { ok: false, error: 'malformed' };
  }

  const expected = sign(payload, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    return { ok: false, error: 'bad_signature' };
  }
  if (exp <= now) return { ok: false, error: 'expired' };

  return { ok: true, claims: { room, game, player, exp } };
}
