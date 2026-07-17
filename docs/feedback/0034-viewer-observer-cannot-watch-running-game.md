# 0034 - A viewer-only member cannot watch a running game (engine refuses the spectator join)

Captured from a live 3-role playthrough (interactive host + remote guests + an OBSERVER joined
viewer-only) on the authenticated join. The observer never saw the game and never reached the final
results - it sat on the viewer's empty "Get ready" screen for the whole match.

## Symptom

A member who joins viewer-only (the "Viewer" mode in the lobby's mode picker, spec 0050) is a real
room member but is NOT a player. When the host starts the game, the viewer's device transitions into
the running game (the room-status poll flips to `running`) and opens its engine WebSocket - but the
viewer pane stays on the game's empty initial state ("Get ready. The first branch is on its way.")
and never renders the live round, the reveal, or the final standings. The players are unaffected.

## Root cause

The engine's `join()` looked up the connecting `player` in the handed-off roster and threw
`UnknownPlayerError` when it was absent. But the handoff roster (`toHandoffPlayers`) contains only
the PLAYING seats (`isPlaying`) - viewers are deliberately excluded, since a viewer takes no turn. So
a viewer's authenticated join (its own valid spec-0064 token) was refused with "player ... is not in
this session's roster", the socket sent a targeted `error` frame instead of the catch-up frames, and
the viewer's pane never received the current `prompt`/`state`. A fast game could even complete and
flip the room back to the lobby before the viewer noticed anything at all.

## Fix

- **Admit a non-roster join as a SPECTATOR** (`apps/game-engine/src/engine.ts`). When the joining id
  is not a session player, `join()` no longer throws; it returns the PUBLIC catch-up frames
  (`prompt` / `reveal` / `leaderboard` / `sim` / `state`) so the viewer renders the live game. The
  spectator is never seated (no roster mutation, no connected flag) and is never handed a `private`
  payload - `catchUpFrames` only ever looks up THIS id's own secret, and a spectator has none. Hidden
  info stays airtight: the observer receives only broadcast state, exactly like every non-secret
  holder. Who reaches the engine at all is still gated by spec-0064 auth (the control-plane only
  mints a token over a caller's own membership), so this does not widen the trust boundary.
- Updated the engine + socket unit tests to assert the spectator path (public state frame, no seat,
  no secret) and removed the now-dead `UnknownPlayerError`.

## Learning

A "viewer/observer" role only works end to end if the engine treats a non-playing member as a
first-class SPECTATOR - subscribed to the broadcast, given the current-phase catch-up, but never
seated and never handed a secret. Refusing the join because the member is not a player silently
breaks the entire watch path. Generalize into `overview/learnings.md`.
