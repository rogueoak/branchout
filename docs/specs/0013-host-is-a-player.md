# 0013 - Host is a player

## Problem

The host is modeled as a room **administrator**, not a game **participant**. In Redis membership
the role enum is `'host' | 'player' | 'observer'`, and the host is created as a `host` member with
no mode. Everything downstream treats the host as a non-player:

- `toHandoffPlayers()` filters `role === 'player'`, so the host is never in the engine roster
  (`apps/control-plane/src/rooms/service.ts:383`).
- The host therefore never joins the engine WebSocket, submits no answers, casts no dispute votes,
  and has no entry in the round leaderboard or the final standings (so earns no stars).
- The host has no mode, so it is never a viewer for the start gate, and the in-game layout renders
  the host as a bare viewer pane rather than by a chosen mode.

For a party trivia game the host is a person in the room with a phone; they expect to play. Today
they can only referee. The host should be a full player who *additionally* holds host controls.

Who it's for: every host - the person who creates the room and wants to compete in their own game.

## Outcome

When done, observably:

- The host appears in the roster the engine receives, in the between-round leaderboard, and in the
  final standings, and earns stars by rank exactly like any other player.
- The host submits answers and casts dispute votes from their device, and is marked connected /
  disconnected by presence like any player.
- The host picks a play mode (interactive / remote) and can change it in the lobby, just like a
  player. The picker defaults from the device: a mobile device defaults to **remote**, a detectable
  TV browser defaults to **interactive** (the shared viewer), any other device defaults to
  **interactive**. The host can always override the default.
- An interactive host satisfies the "at least one viewer" start gate on their own, so a host can
  start and play a game solo (or with only remote players).
- The host keeps every admin power unchanged: select game, start, pause/advance/restart/exit, kick a
  member, and see other members' `sessionId`. The host is never kickable and cannot kick itself.
- In-game, the host's screen renders by their chosen mode (interactive = viewer + remote; remote =
  controller) **and** shows the host controls overlay.

## Scope

**In**

- Collapse the membership role model: `Role` becomes `'player' | 'observer'`; a new `isHost:
  boolean` on `RoomMember` carries the host privilege. The host is created as a `player` member with
  `isHost: true` and a default mode.
- Include the host in the engine handoff roster and standings (falls out of the role change; keep
  the observer exclusion explicit).
- Allow the host to set/change mode via the existing `setMode` path.
- Device-aware default for the mode picker (shared helper used by the host lobby control and the
  join page), best-effort TV/mobile detection by user agent.
- Web: host joins the engine like a player; lobby shows the host a mode control; the in-game stage
  renders the host by mode plus the host-controls overlay; the host row is badged as host in the
  member list and leaderboard.
- Update every `role === 'host'` / `role === 'player'` check across control-plane and web to the new
  model (member redaction, `isHost`, kick guard, viewer gate, handoff filter).
- Tests: control-plane unit tests for the new roster/mode/viewer/redaction/kick behavior; web tests
  for the device default and host-as-player rendering; an end-to-end test proving the host plays a
  full game and lands in the final standings (CLAUDE.md rule 2).

**Out**

- Any change to the game-engine. The engine is already roster-driven and player-agnostic; once the
  host is in the handoff roster it plays with no engine change. (We add engine-facing tests only if a
  gap surfaces.)
- Transferring host, multiple hosts, or a host who is deliberately a non-playing observer - the
  answer to "can the host opt out of playing" is **no** for this spec (host is always a player).
- Billing changes. Credits are per-round, not per-player; the host still funds the room via
  `hostAccountId`.

## Approach

**Model.** Replace the mutually-exclusive `host` role with a flag. `Role = 'player' | 'observer'`;
add `isHost: boolean` to `RoomMember`. The host becomes a normal player member that also has
`isHost: true`. This is the smallest change that makes the host flow through the existing
player machinery (roster, join, answer, vote, standings, stars) untouched, while `isHost` carries the
orthogonal admin concern (controls, kick, sessionId visibility).

Key decision / trade-off: an alternative is to keep `role: 'host'` and teach every `role ===
'player'` site to also accept `'host'`. Rejected - it scatters "host counts as a player" across many
call sites and is exactly the separation we are trying to delete. A single flag localizes the
privilege and lets "is this a participant" stay a clean `role` check.

**Control-plane changes** (`rooms/membership.ts`, `rooms/service.ts`):

- `membership.ts`: `Role = 'player' | 'observer'`; add `isHost: boolean` to `RoomMember`. `isViewer`
  keeps its definition (`observer || (player && interactive)`) - the host, being a `player`, is a
  viewer exactly when interactive.
- `createRoom`: create the host as `{ role: 'player', isHost: true, mode: <default>, ... }`. Server
  default mode is `interactive` (safe fallback; the client refines it from the device and calls
  `setMode`).
- `setMode`: allow any `player` member (the host now qualifies). Drop the "host has no mode" copy.
- `toHandoffPlayers`: filter `role === 'player'` (unchanged predicate, now includes the host);
  observers still excluded. Add a comment that the host is intentionally included.
- `members` redaction: `caller.isHost` (was `caller.role === 'host'`) sees `sessionId`.
- `kick`: also refuse to kick an `isHost` member (belt-and-suspenders on top of the self-kick guard).
- `requireHost` is unchanged - it authorizes against `room.hostAccountId` in Postgres, independent of
  the membership role.
- Expose `isHost` on the members payload (it is a `RoomMember` field, so it already serializes; add it
  to any explicit view/DTO shaping if present).

**Web changes**:

- `RoomClient.tsx`: `isHost` derives from `membership?.isHost`. The host establishes the engine
  connection and sends `join` with its `playerId` (read from its own member row) like any player.
- New `lib/default-mode.ts` (or similar): `defaultMode(userAgent)` -> `interactive | remote`. TV UA
  match (SmartTV, Tizen, Web0S/webOS, AFT* Fire TV, GoogleTV, AppleTV, HbbTV, NetCast, BRAVIA,
  CrKey, PlayStation, Xbox) -> `interactive`; mobile UA (`/Mobi|Android|iPhone|iPad/`) -> `remote`;
  else `interactive`. Best-effort and always overridable. Used by the host lobby mode control and the
  join page's initial mode.
- `Lobby.tsx`: show the host a mode control (interactive/remote) that calls `setMode`, initialized
  from `defaultMode`. Badge the host row and keep the host-only config/start panel.
- `GameStage.tsx`: render the host by `mode` (like a player) and additionally render the host-controls
  overlay when `isHost`. Leaderboard/standings badge the host row.

**Testing.** Control-plane: host is in `toHandoffPlayers`; host `setMode` works; interactive host
passes `hasViewer` and a solo interactive host can start; a remote-only host + no observer fails the
viewer gate; host still sees `sessionId`, non-host still redacted; host is not kickable. Web: the
device-default matrix (mobile -> remote, TV UA -> interactive, desktop -> interactive); the host
renders as a player-by-mode with controls. End-to-end: a host + one player play a full Trivia game
and both appear in the final standings with stars assigned by rank.

## Acceptance

- [ ] `Role` is `'player' | 'observer'`; `RoomMember` has `isHost`; the host is created as a
      `player` with `isHost: true` and a default mode.
- [ ] The engine handoff roster and the final standings include the host; the host earns stars by
      rank. (unit + e2e)
- [ ] The host can submit answers and dispute votes and is tracked by presence. (e2e)
- [ ] The host can set/change mode; the picker default is device-aware (mobile -> remote, TV ->
      interactive, else interactive) and overridable. (unit + web test)
- [ ] An interactive host satisfies the viewer gate; a solo interactive host can start. A remote-only
      host with no other viewer cannot start. (unit)
- [ ] The host retains select/start/control/kick and `sessionId` visibility; the host is not
      kickable and cannot kick itself. (unit)
- [ ] In-game, the host's screen renders by mode and shows the host controls. (web test)
- [ ] Lint, typecheck, build, and the full test suite pass.
