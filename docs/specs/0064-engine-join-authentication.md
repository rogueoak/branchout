# 0064 - Engine-join authentication (a per-connection token)

## Problem

The engine WebSocket `join` frame carries a client-supplied `player` id, and playerIds are **public**
- every device sees them broadcast in every `state` frame's `players[].player`. The engine only checks
the id is in the roster it was handed; it never proves the connecting device **is** that player. So a
participant can open a socket and `join { player: <victim-id> }`: the socket layer then subscribes them
to the victim's `private:{room}:{game}:{player}` channel, join catch-up hands back the victim's stored
private payload, and every later private delivery to the victim also reaches the impersonator. They can
likewise spoof the victim's moves and votes.

This voids spec `0052`'s per-player secrecy guarantee (feedback `0033`): a hidden-information game's
entire value is that a secret reaches only its owner, but that secret is keyed on a `player` id the
connection merely **asserts** for itself. A new secret channel inherits the weakest identity gate on
the connection it rides, and today that gate is "trust the client". Until the join is authenticated, no
hidden-information game can assume airtight secrecy.

## Outcome

- The engine WebSocket `join` is **authenticated**: when the shared secret is configured (dev/e2e/prod),
  a join must carry a short-lived token that proves the connecting device is the claimed `player`, and
  the engine refuses the join otherwise - so a device can no longer impersonate another player.
- The token can only ever be obtained for the caller's **own** playerId. The control-plane owns the
  private `sessionId <-> playerId` mapping and mints the token over the caller's own membership; there
  is no path to a token for someone else's id.
- Spec `0052`'s secrecy now genuinely holds: a second connection cannot join as another player, so it
  never subscribes to that player's private channel and never receives their secret.
- The change is **additive** under the same `PROTOCOL_VERSION` (a new optional `token` field on the
  existing `join` frame, a new control-plane GET endpoint), so it is safe for the one-at-a-time rolling
  deploy and breaks no existing game.

## Scope

**In**

- Protocol: an optional `token` field on `JoinMessage`, parsed additively; a shared `engine-auth`
  module (`mintEngineToken` / `verifyEngineToken`) that both services import, so mint and verify can
  never drift.
- Control-plane: a session-authenticated `GET /v1/rooms/:code/engine-token` that resolves the caller's
  OWN membership and returns an HMAC token bound to `{room.id, selectedGame, playerId}` plus its `exp`.
- Engine: when `ENGINE_AUTH_SECRET` is set, the socket REQUIRES a valid token on join - recompute the
  HMAC, check `exp`, and check the token's player equals the join's `player` - before subscribing to any
  channel; reject (a targeted `error`, never a broadcast) otherwise. Bind the socket to the
  authenticated player.
- Web: the game client fetches the token (control-plane, over the session cookie) and includes it in the
  join frame, refreshing it so a mid-game reconnect always joins with a live token.
- Env wiring: `ENGINE_AUTH_SECRET` on control-plane + game-engine (one shared value), the dev/e2e
  overlays, and the deploy env docs. A server secret - never `NEXT_PUBLIC`.
- Tests proving: absent/expired/mismatched/forged tokens are rejected; a valid token binds and lets the
  player act; the load-bearing secrecy test holds WITH auth; the token endpoint mints only for the
  caller's own membership and 401/404/409/503s otherwise; the web client fetches + includes the token.

**Out**

- Authenticating the server-to-server engine REST intake (`/v1/sessions`) - that is a separate,
  network-isolated channel (its own follow-up), not the player WebSocket this spec closes.
- Encrypting the private payload in transit beyond the existing transport (a player may see their own
  secret; the guarantee is that others never receive it).
- A `PROTOCOL_VERSION` bump or any breaking change to existing frames.

## Approach

### The token: a stateless HMAC

A token is `${room}.${game}.${player}.${exp}.${signature}` where the signature is base64url
HMAC-SHA256 of `${room}.${game}.${player}.${exp}` under the shared `ENGINE_AUTH_SECRET`. It carries no
secret itself (the ids are public, `exp` is a timestamp); its only power is proving the control-plane
vouched for that exact bind. Stateless, so the engine verifies it with no lookup and it survives an
engine restart / cross-instance fan-out. Short TTL (120s): it is fetched right before connecting and
re-fetched on reconnect, so a leaked token is useless within a couple of minutes. `mintEngineToken` /
`verifyEngineToken` live in `@branchout/protocol` so both services share one implementation; the
signature compare is constant-time.

### Control-plane mints over the caller's own membership

`GET /v1/rooms/:code/engine-token` is session-authenticated exactly like the other room routes. It
resolves the caller to their own `RoomMember` via `rooms.resume` (re-seating a returning host,
throwing `not_member` for a genuine stranger), then mints a token bound to `room.id` (the engine's room
key, which the browser sends as the join `room`), the room's `selectedGame`, and the caller's own
`playerId`. Because the endpoint only ever reads the caller's OWN membership, it can never mint a token
for another player's id. Returns 401 (no session), 404 (`not_member`), 409 (no game selected yet), 503
(secret unset - dev/tests).

### Engine requires + verifies the token on join

`attachGameSocket` takes an optional `authSecret`. When set, `handleJoin` authenticates BEFORE
subscribing to any channel - so an unauthenticated device never reaches the per-player `private:`
channel it would otherwise subscribe to. It requires a `token`, verifies the HMAC + `exp`, and checks
`claims.room/game/player` all equal the join frame's - critically `claims.player === join.player`, the
impersonation case (a valid token for p2 presented on a join claiming p1 is refused). On any failure it
sends a targeted `error` frame (never a broadcast, like `move_rejected`) and does not bind. When the
secret is unset (pure-unit tests only), enforcement is skipped so those tests need not sign.

### Web fetches + threads the token

`RoomClient` fetches the token (`fetchEngineToken` -> control-plane, credentialed) once the game is
running and this device has a resolved identity, and REFRESHES it on a 90s interval (< the 120s TTL) so
a mid-game reconnect always has a live token. The game socket is only opened once a token is held
(gating on it avoids a doomed join the engine would reject). The `GameClient` includes the token in the
join frame and exposes `updateToken` so a refreshed token takes effect on the next (re)join without
churning a healthy socket.

## Acceptance

- [ ] `JoinMessage` has an optional `token` field, parsed additively; no `PROTOCOL_VERSION` bump.
- [ ] `mintEngineToken` / `verifyEngineToken` round-trip; verify rejects a wrong-secret, tampered, or
      expired token; both live in `@branchout/protocol` (one shared implementation).
- [ ] `GET /v1/rooms/:code/engine-token` mints a token bound to the caller's OWN playerId, and 401/404/
      409/503s appropriately; a member never gets a token for another player's id.
- [ ] With the secret set, the engine rejects a join with an absent, expired, or mismatched (player !=
      token's player) token, and a valid token binds the player and lets it act.
- [ ] The load-bearing secrecy test holds WITH auth: a second connection cannot join as another player
      and never receives that player's private payload (extends the spec 0052 secrecy engine test).
- [ ] The web client fetches the token and includes it in the join frame (unit-tested), and refreshes
      it so a reconnect joins with a live token.
- [ ] `ENGINE_AUTH_SECRET` is wired into control-plane + game-engine, the dev/e2e overlays, and the
      deploy env docs; it is a server secret, never `NEXT_PUBLIC`.
- [ ] Build, lint, typecheck (whole repo incl. `@branchout/e2e`), and unit/integration tests are green;
      existing games still connect and play with the token path (e2e against the live stack).
