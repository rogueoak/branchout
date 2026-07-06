# 0010 - Web client integration gaps with the control-plane and protocol

## Symptom

Building the web game client (spec `0010`) against the existing control-plane (`0006`) and protocol
(`0007`) surfaced four places where the browser cannot fully close the loop with what those specs
expose today. The client is built correctly against the intended contracts; these are missing
server-side pieces, each a small, additive change, captured here so the next control-plane/protocol
spec can close them.

1. **The browser cannot learn its own engine player id.** The engine's `join` binds a device to a
   `player` that must already be in the roster the control-plane handed off, and the roster is keyed
   by the control-plane session id (`toHandoffPlayers` uses `member.sessionId`). That id lives in an
   httpOnly cookie the browser cannot read, and `/rooms/:code/members` redacts `sessionId` for
   everyone but the host. So a non-host player has no way to send the correct `player` on the engine
   `join`, and `engine.join` throws `UnknownPlayerError`. Only the host can self-identify (their own
   host row).

2. **The host cannot advance rounds from the browser.** `engine.control` supports `advance`, and the
   Trivia flow needs it (the collecting -> reveal transition and the leaderboard -> next-round
   transition are host-driven, not timed). But the browser-facing `/rooms/:code/control` route
   accepts only `pause | restart | exit` and 400s on `advance`.

3. **The vote UI cannot name the disputers.** The wire `state` frame carries phase/paused/round/
   players/scores but not `SessionState.disputes`, so a voting-phase client does not know which
   players raised a dispute. The client works around it by offering the ballot over the round's
   wrong-answer set (the dispute-eligible players); the engine ignores a ballot cast on a non-
   disputer, so the outcome is correct, but the UI shows more candidates than actually disputed.

4. **No credit-balance read for the affordability pre-gate.** There is no endpoint returning the
   host's balance, so the Start button cannot pre-check affordability. Per the spec this gate is a
   courtesy and the server is the authority, so the client relies on the `insufficient_credits`
   refusal returned by `/rooms/:code/start` and shows it as the Start reason. This one is acceptable
   as-is; noted for completeness.

## Root cause

Specs `0006`/`0007` were built server-first, before a browser consumer existed, so the read surface
a browser needs (its own identity in a room, an advance control, the disputers in the state
projection) was never required by a caller. The engine's internal capabilities (`advance`, the
`disputes` list) simply were not projected outward.

## Fix

Deferred to a control-plane/protocol follow-up (out of `0010`'s file ownership - the web client owns
`apps/web` only). The web client is written to the intended contracts so each lands as a small
additive change:

- Return the caller's member/player id on `POST /rooms/:code/join` (and in `/members` for self), so
  a non-host device can `join` the engine. The client already threads a `player` field through
  `Membership` and `GameClient`; it just needs the value.
- Add `advance` to the `/rooms/:code/control` allow-list (it already reaches `engine.control`). The
  client's `controlGame` already types and sends `advance`.
- Add `disputes: string[]` to the protocol `StateMessage` (or a dedicated `dispute` frame). The
  client's vote UI can then target the exact disputers instead of the wrong-answer set.
- Optionally expose a balance read for a true affordability pre-gate.

## Learning

**A service that a browser will later consume must project outward the reads that consumer needs -
the caller's own identity within a resource, every host action the UI offers, and any state the UI
must render - not just the writes and the server-to-server calls.** An internal capability the
engine has (`advance`) or holds in state (the disputers) is invisible to a front end until a route
or a wire field exposes it, and an identity kept only in an httpOnly cookie cannot be echoed back by
client code. When a server spec precedes its UI, budget a read surface for the UI: the caller's role/
id in the resource, a proxy for every control the UI will show, and a state projection rich enough
to render every phase. This generalizes past Trivia to every game the engine will run.
