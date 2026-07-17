# 0033 - Engine join is unauthenticated, so private payloads are only as secret as that gate

> **RESOLVED** by spec `0064` (engine-join authentication). The deferred token/session check on the
> socket connection now exists: when `ENGINE_AUTH_SECRET` is set (dev/e2e/prod), the WebSocket `join`
> REQUIRES a short-lived HMAC token the control-plane mints over the caller's OWN membership and the
> engine verifies (binding the socket to the authenticated player). A device can no longer join as
> another player and subscribe to their `private:` channel, so spec `0052`'s per-player secrecy now
> genuinely holds - proven by the engine "secrecy holds WITH auth" test. The accepted residual risk
> below is closed.

Captured from persona review of spec `0052` (per-player private payloads, PR #105). The seam
delivers a per-player secret over a per-player channel, but the whole secrecy guarantee rests on
one gate that does not actually authenticate who is asking.

## Symptom

Spec `0052` ships a hidden-information seam: the engine hands each player an opaque secret over a
per-player channel (`private:{room}:{game}:{player}`) that only that player's connection subscribes
to, so no other device receives it off the wire. The guarantee holds only as strongly as the
engine's WebSocket `join` identity - and today that identity is self-asserted.

## Root cause

The engine `join` trusts the client-supplied `player` id and only checks that it exists in the
roster (`UnknownPlayerError`). It never proves the connecting device *is* that player. playerIds are
public - every device sees them broadcast in `state.players[].player`. So any participant can open a
socket, send `join { player: <victim-id> }`, and the socket layer subscribes them to the victim's
`private:{room}:{game}:{player}` channel; join catch-up then hands back the victim's stored payload
and every later delivery to the victim reaches the impersonator too.

This gap pre-exists `0052`: the same self-asserted identity already lets a client spoof another
player's moves and votes. What `0052` changes is the *impact* - it raises the stakes from "act as
another player" to "read another player's secret" (join as the victim, subscribe to their private
channel). A game whose entire value is secrecy cannot be built assuming that secrecy holds today.

## Fix

- **Defense-in-depth in the web reducer (this PR).** The client ignores a `private` frame whose
  recipient (`frame.player`) is not the local player, so a mis-targeted or replayed frame never
  paints another player's secret into this device's UI. This does not close the server gap; it just
  refuses to render a secret that was not addressed here.
- **This documented contingency (this PR).** No hidden-information game may assume airtight secrecy
  until engine-join identity is authenticated - the deferred token/session check on the socket
  connection (a tracked follow-up). For the current insider (trusted-friends) playtest scope, this
  residual risk is accepted and recorded here rather than blocking the seam.

## Learning

A new secret channel inherits the *weakest* existing identity gate on the connection it rides. The
`private:` channel is perfectly targeted, but it keys on a `player` id the connection asserted for
itself, so it is exactly as private as that assertion - which is not at all. Authenticate identity
*before* keying secrets on it, or the secret is only as private as that gate. Generalize into
`overview/learnings.md`.
