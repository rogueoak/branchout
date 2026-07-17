# 0052 - Per-player private payloads (hidden information)

## Problem

Several games in the next wave turn on *hidden information*: a clue-giver who alone sees which grid
tiles are their team's, a player who alone does not know the shared location, a hand of number cards
only its holder may see, a spectrum target only the reader knows, a secret word one player must not
see. Today the engine has no way to deliver such a secret. Every streamed frame - `prompt`, `state`,
`reveal`, `sim`, `leaderboard` - is **broadcast** to every device over the room's pub/sub channel;
the only targeted frame is `move_rejected`, a one-off reply to the submitting device. Hiding a secret
purely in the browser would ship it to every device and let any player read it off the wire - which
defeats the entire point of a hidden-information game (a leaked spymaster key or spy identity ends
the game before it starts).

This is shared setup the hidden-information games depend on. Build it once, here, and each of those
games consumes it.

## Outcome

- A game module can emit a **per-player private payload**: opaque, game-defined data that the engine
  delivers **only** to that player's own device(s) and to no one else - not over the broadcast
  channel.
- A player who should not see a secret never receives it, even if they inspect their network traffic
  (the payload is never sent to them).
- A (re)joining or reconnecting device recovers its current private payload as part of join catch-up,
  so a dropped connection does not lose the secret.
- The change is **additive** under the same `PROTOCOL_VERSION` (a new server-only frame + optional
  lifecycle returns), so it is safe for the one-at-a-time rolling deploy and breaks no existing game.

## Scope

**In**

- Protocol: a new `PrivateMessage` server->client frame (targeted, never parsed on ingress), added to
  `ServerMessage`, with a constructor; documented additive under the same `PROTOCOL_VERSION`.
- Game SDK: an optional `private?: Record<string, unknown>` (playerId -> that player's payload) on
  `StartRoundResult`, `RevealResult`, and `LiveTickResult`, with contract docs.
- Engine: deliver each `private` entry only to that player's connection(s) (reusing the targeted-send
  path `move_rejected` uses), persist the latest per-player payload in session state for join
  catch-up, and reset it when a new round starts.
- Web: fold the `private` frame into `GameState` so a game's UI module reads the local player's own
  secret (`state.private`), including after a reconnect.
- A test stub game (SDK fixture) that emits private payloads, and tests proving secrecy, catch-up,
  and per-round reset.

**Out**

- The games themselves (each is its own spec; they call this seam).
- Per-player *public* variation (this is for secrets, not per-device layout).
- A `PROTOCOL_VERSION` bump or any breaking change to existing frames.
- Encrypting the payload in transit beyond the existing transport (a player may see *their own*
  secret; the guarantee is that *others* never receive it).

## Approach

### Protocol: a targeted `private` frame

Model it on `MoveRejectedMessage` (the existing targeted, server-only, additive frame). In
`packages/protocol/src/messages.ts`:

```ts
/**
 * A per-player secret payload (hidden information: a spymaster key, a hidden role, a private hand).
 * Targeted, sent only to the recipient's device(s), never broadcast over pub/sub, so no other player
 * receives it. `private` is opaque, game-defined. Additive, server -> client only (never parsed off
 * the wire), under the same PROTOCOL_VERSION.
 */
export interface PrivateMessage {
  v: number;
  type: 'private';
  room: string;
  game: string;
  round: number;
  player: string;   // the recipient; echoed so the client can confirm the target is itself
  private: unknown;
}
```

Add `PrivateMessage` to the `ServerMessage` union and a `privateMessage(state, player, payload)`
constructor beside the others. It is *not* added to `IngressMessage`/`parseMessage` - the server only
ever sends it, exactly like `move_rejected`, so a hostile client cannot inject one.

### Game SDK: an optional `private` return

In `packages/game-sdk/src/lifecycle.ts`, add to `StartRoundResult`, `RevealResult`, and
`LiveTickResult`:

```ts
/**
 * Per-player secret payloads for this frame: playerId -> that player's opaque private data. The
 * engine delivers each entry ONLY to that player's device(s) (never broadcast), persists the latest
 * per player for join catch-up, and clears it when the next round starts. A player absent from the
 * map simply has no secret this frame. Optional and additive: a game that never sets it is
 * unaffected.
 */
private?: Record<string, unknown>;
```

`startRound.private` covers deal-time secrets (roles, hands, a hidden target, a per-player prompt);
`tick.private` covers a live game whose secret can change (a shifting private hand, a spymaster key
that should re-send); `reveal.private` covers a secret disclosed differently per player at reveal.
These three cover every hidden-info game in the wave.

### Engine: deliver targeted, persist for catch-up, reset per round

- After a lifecycle call returns a result carrying `private`, the main thread (which owns the
  sockets; the module runs in a worker and returns plain serializable data) iterates the map and, for
  each playerId with a live connection, publishes a `PrivateMessage` to that player's own **per-player
  Redis pub/sub channel** `private:{room}:{game}:{player}`, which only that player's connection(s)
  subscribe to. It is never published to the broadcast `stream:` channel. NOTE: delivery landed as
  this dedicated per-player pub/sub channel, not the `move_rejected` per-connection socket send this
  Approach first sketched: a deal-time or tick secret has no originating socket and must fan out
  across engine instances exactly like `stream:`, which the socket send cannot do. Catch-up still
  mirrors `move_rejected` (a targeted reply to the joining connection).
- Secrecy is bounded by engine-join authentication. The `private:{room}:{game}:{player}` channel keys
  on the `player` id the `join` frame self-asserts, and that join is not yet authenticated (playerIds
  are public), so a device can join as another player and subscribe to their channel. The seam ships
  with a defense-in-depth recipient check in the web reducer and a documented contingency (feedback
  `0033`); airtight secrecy is a tracked follow-up gated on authenticating the join identity.
- The latest per-player payload is stored in `SessionState` (e.g. `privatePayloads: Record<string,
  unknown>` scoped to the current round). On (re)join, the join/catch-up path
  (`engine.ts` `catchUpFrames`) sends the joining player *their* stored payload (if any) as a
  `PrivateMessage`, so a reconnect restores the secret. It never sends another player's payload.
- `startRound` resets `privatePayloads` for the new round (the same pruning discipline the engine
  already applies to per-round scratch), so a stale secret never leaks into a later round.

### Web: fold into `GameState`

`apps/web/lib/game-client.ts` decodes a `private` frame; `game-state.ts` reduces it into
`state.private` (the local player's own secret - the frame is already targeted to this device, so the
reducer just stores its `private` field, replacing on each new one and clearing on round change). A
game's `Viewer`/`Remote` reads `state.private` to render what only this player may see. A reconnect
re-hydrates it from the catch-up frame.

### Tests

- Protocol: `privateMessage(...)` round-trips through `serializeMessage`; `parseMessage` REJECTS a
  `type: 'private'` ingress frame (server-only, like `move_rejected`).
- Engine (the load-bearing secrecy test): a stub game returns `private: { A: secretA, B: secretB }`;
  assert player A's socket receives `secretA`, player B's receives `secretB`, and **A never receives
  secretB nor B secretA**, and nothing lands on the broadcast channel. Assert a re-joining player
  gets their current payload as catch-up, and that `startRound` clears the prior round's payloads.
- SDK: extend the lifecycle test stub with a private-payload path.
- Web: the reducer stores the local private payload and clears it on a new round; a reconnect frame
  restores it.

## Acceptance

- [ ] A new `PrivateMessage` (`type: 'private'`) exists in the protocol, is in `ServerMessage`, has a
      constructor, is additive under the same `PROTOCOL_VERSION`, and is never accepted by
      `parseMessage` (a test asserts ingress rejection).
- [ ] `StartRoundResult`, `RevealResult`, and `LiveTickResult` accept an optional
      `private: Record<playerId, unknown>`.
- [ ] The engine delivers each private payload ONLY to its target player's connection(s) and never on
      the broadcast channel; a test proves player B never receives player A's secret.
- [ ] A (re)joining player receives their current private payload as join catch-up; another player's
      payload is never sent to them.
- [ ] Private payloads reset when a new round starts.
- [ ] The web client exposes the local player's private payload to the game UI (`state.private`),
      restored after a reconnect.
- [ ] Build, lint, typecheck, and unit/integration tests are green; no `PROTOCOL_VERSION` bump.
