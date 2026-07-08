# 0014 - Pause the game while the host is disconnected

## Problem

The host runs the game: only the host advances rounds, pauses, restarts, and exits. If the host's
device drops mid-game (closes the tab, loses signal, backgrounds the phone), the round is stranded -
no one can advance it, and the remaining players sit with no way forward. The engine currently marks
a disconnected player offline and does nothing else; it does not even know which player is the host,
because the start handoff roster omits that fact.

## Outcome

When the host disconnects mid-game, the game auto-pauses and every remaining player sees a "waiting
for the host to reconnect" state. When the host reconnects, the game resumes where it left off. A
non-host disconnecting changes nothing about pause state (the game plays on).

## Scope

**In**

- Carry `isHost` on the start-handoff roster and store it on the engine session's players.
- On the host's disconnect, if the game is live (not already paused, not complete), set
  `paused = true` and broadcast the state so clients render the paused/waiting UI.
- On the host's reconnect, if the game was auto-paused by that disconnect, clear the pause and
  broadcast; re-arm any timed dispute/vote window as a manual resume does today.
- Web: the paused state already exists; surface host-specific copy ("Waiting for the host to
  reconnect...") so players understand why it stalled.

**Out**

- Host handoff / promoting another player to host (a bigger product decision).
- A grace timer or auto-exit if the host never returns (future; for now it stays paused).
- Distinguishing a deliberate host pause from an auto-pause in the UI beyond the copy above.

## Approach

`isHost` is orthogonal to the player role (learnings: it is a flag, not a role), so add it as an
**optional** field on `HandoffPlayer` and on the engine's `SessionPlayer`, defaulting absent to
`false` - an additive change under the same protocol version (learnings: a new envelope field is
optional-and-defaulted unless the version bumps). The control-plane already has `member.isHost`;
map it through `toHandoffPlayers`.

Track *why* the game is paused so a non-host reconnect, or a host's own manual pause, does not get
undone by the disconnect logic. Add `hostPaused: boolean` to `SessionState`: the disconnect handler
sets `paused = true` and `hostPaused = true` only when the disconnecting player `isHost` and the
game is live; the reconnect (join) handler clears both only when `hostPaused` is set. A manual host
pause leaves `hostPaused` false, so reconnecting does not silently un-pause a deliberately paused
game.

## Acceptance

- [ ] The handoff roster carries `isHost`; the host's engine session player has `isHost: true`.
- [ ] Host disconnect on a live game sets `paused` and broadcasts a `state` frame with `paused: true`.
- [ ] Host reconnect on an auto-paused game clears `paused` and broadcasts `paused: false`.
- [ ] A non-host disconnect/reconnect never changes `paused`.
- [ ] A manual host pause is not cleared by an unrelated reconnect.
- [ ] Web shows host-aware copy while paused for a host disconnect.
- [ ] Covered by an engine unit test (pause/resume matrix) and the end-to-end flow.
