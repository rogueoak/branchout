# 0012 - Trivia end-to-end integration

## Problem

Specs `0006` (rooms orchestration) and `0007`/`0008` (engine + Trivia) were built server-first,
before a browser consumer existed. The web Trivia client (`0010`) is written against the intended
contracts, but three server-side reads a browser needs were never projected outward, so a full game
cannot be played from a browser by a non-host player:

1. **No engine identity for a non-host player.** The engine's `join` binds a device to a `player`
   that must already be in the roster the control-plane handed off, and the roster is keyed by the
   control-plane session id (`toHandoffPlayers` uses `member.sessionId`). That id lives in an
   httpOnly cookie the browser cannot read, and `/rooms/:code/members` redacts `sessionId` for
   everyone but the host. A non-host player therefore has no id to send on the engine `join`, and
   `engine.join` throws `UnknownPlayerError`.
2. **No `advance` control from the browser.** `engine.control` supports `advance`, and the Trivia
   flow needs it (the collecting -> reveal and leaderboard -> next-round transitions are host-driven,
   not timed). But `/rooms/:code/control` accepts only `pause | restart | exit` and 400s on
   `advance`.
3. **No disputers in the state projection.** The wire `state` frame carries phase/paused/round/
   players/scores but not `SessionState.disputes`, so a voting-phase client cannot name which
   players actually raised a dispute; the vote UI falls back to the round's wrong-answer set.

(Gap 4 in `docs/feedback/0010-web-client-integration-gaps.md` - a credit-balance read for the Start
affordability pre-gate - is out of scope. The server remains the affordability authority and the
`insufficient_credits` refusal is acceptable as-is.)

## Outcome

A full Trivia game is playable start to finish from the browser by the host and by non-host
players: start -> prompt -> answers -> reveal -> dispute -> vote -> leaderboard -> host advance ->
next round -> complete. A non-host device learns a stable engine identity on join and connects; the
host can advance rounds; the vote UI lists exactly the players who disputed.

## Scope

In:

- A public, non-sensitive `playerId` per room member, distinct from the httpOnly `sessionId`, used
  as the engine roster/`join` identity.
- `advance` added to the `/rooms/:code/control` allow-list and the `ControlAction` type.
- `disputes: string[]` (playerIds) added to the protocol `StateMessage`, populated by the engine
  during voting and consumed by the web vote UI.
- Threading the returned `playerId` and the `disputes` field through the web client.

Out:

- The credit-balance read (gap 4); per-player engine auth (still deferred to a later spec); any
  change to how `sessionId` authenticates control-plane actions.

## Approach

- **playerId vs sessionId.** Mint a random, url-safe `playerId` (same generator family as the
  session id, 256-bit) on room create and join, and store it on the `RoomMember` beside `sessionId`
  in Redis. The engine roster (`toHandoffPlayers` / `StartHandoffRequest.players`) and the engine's
  `join` matching switch to `playerId`; `sessionId` stays private (host-only, the kick/rejoin key)
  and is never returned to JS. `playerId` is safe to expose: it is already broadcast to every device
  inside the `state` frame's `players[].player`, so echoing it on `join` and in `/members` leaks
  nothing new. `POST /rooms/:code/join` returns the caller's `playerId`; `/members` includes
  `playerId` on every row (still redacting `sessionId` for non-hosts).
- **advance.** Add `advance` to the route allow-list and to `ControlAction`; the service already
  forwards the action to `engine.control`, which already handles it.
- **disputes.** Add `disputes: string[]` to `StateMessage`; the engine copies `state.disputes` into
  every `state` frame (already populated on the disputing -> voting transition). The web reducer
  folds it into `GameState.disputes`, and the remote vote UI offers the ballot over the disputers
  (minus self) instead of the wrong-answer set.

## Acceptance

- [ ] A `playerId` is minted per member on create/join, stored beside `sessionId` in membership.
- [ ] The start handoff roster is keyed by `playerId`; a non-host device can `join` the engine with
      the `playerId` returned to it.
- [ ] `sessionId` is never returned to a non-host (no JS-readable session token).
- [ ] `POST /rooms/:code/control` accepts `advance` and reaches the engine; unknown actions 400.
- [ ] The `state` projection includes the current disputers during voting.
- [ ] The web vote UI lists exactly the disputers.
- [ ] Tests green: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
</content>
</invoke>
