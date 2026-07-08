# 0013 - Host is a player: persona-review fixes

Feedback from the Spectra persona review of PR #23 ("Host is a player"). The spec collapsed the
mutually-exclusive `'host'` role into an `isHost: boolean` on a `'player'` member. Three majors and
several minors surfaced where a re-entry path, a test, or a piece of copy did not keep up with that
change.

## Major 1 - `join` dropped the host flag on a rejoin

### Symptom

A host re-entering a room through the Rejoin link (which goes through the `join` path) came back as
`isHost: false`, and if they picked "observer" they lost `role: 'player'` too - dropped from the
engine roster and standings, no longer able to see other members' `sessionId`, and the kick-guard
that refuses `isHost` targets no longer protected them. Meanwhile `requireHost` still authorized them
against Postgres `hostAccountId`, so the room believed they were the host while membership said they
were a plain observer: the invariant `isHost => role === 'player'` was broken.

### Root cause

`createRoom` set `isHost: true` on the host row, but `join` rebuilt the member from scratch and
hardcoded `isHost: false` with a comment "the host is minted by createRoom". That assumed `join` is
only ever a first entry, but the Rejoin link routes a returning host straight through `join`. The
flag was derived from the request, not from the authoritative room.

### Fix

`join` now derives host status from the room, not the request:
`const isHost = !!session.accountId && session.accountId === room.hostAccountId;`. When `isHost` it
forces `role: 'player'`, sets `isHost: true`, preserves the host's existing mode across the rejoin
(else the requested/default mode), and keeps the reused `playerId`. A non-host join still sets
`isHost: false` and honors the requested role/mode.

### Learning

When a create path sets an invariant flag, every re-entry path (rejoin) must preserve or re-derive
it - ideally from the authoritative source (the room's `hostAccountId`) rather than trusting the
request, which the actor can shape.

## Major 2 - the e2e stopped at the input seam, not the scored outcome

### Symptom

The "host reaches the engine" test asserted only that the host's `playerId` appeared in
`engine.starts[0].players` (the handoff input). A regression that carried the host into the roster
but then dropped it from the final standings - so the host earned no stars - would have left that
test green.

### Root cause

The test proved the handoff input, not the user-visible outcome (host in final standings, host earns
stars). CLAUDE.md rule 2 asks the happy path to be covered end to end.

### Fix

Added a test that drives `recordGameComplete` with standings ranking the host's `playerId` first and
asserts the persisted stars award the host three stars (rank 1). `InMemoryRoomRepository` now retains
the recorded games (mirroring the Postgres `stars` column) so a test can read the awarded stars back.
Also asserted the created host row is `connected: true`.

### Learning

A rule-2 end-to-end must assert the user-visible outcome (host in standings + stars), not just the
handoff input. Test the scored result, not the seam that feeds it.

## Major 3 - the host-defaults-remote start dead-end

### Symptom

A phone host now defaults to `remote` (not a viewer). A solo or all-phones party then hits the Start
gate showing "Waiting for a viewer to join," which is misleading: the host can fix it themselves by
switching to Interactive, but the copy told them to wait for someone else.

### Root cause

The device-aware default (mobile -> remote) silently broke the viewer gate, and the blocked-state
copy did not account for the actor being the one who could fix it.

### Fix

The blocked-start reason is now host-aware. When start is blocked for no viewer AND the caller is a
host that is currently `remote` (the only viewer-capable device), the copy reads "You're the only
viewer-capable device here. Switch yourself to Interactive above to start." The generic
"needs a viewer" copy stays for every other case. Wired via a `hostCanSelfFix` prop from `Lobby`
(computed from the host's own mode) into `HostConfigPanel`.

### Learning

A device-aware default must not silently break a gate; the blocked-state copy must tell the actor how
to self-fix when they are the one who can.

## Minors

- **JoinForm hydration mismatch**: the mode `useState` ran `defaultMode(navigator.userAgent)` during
  SSR and mismatched the client on mobile. Now it initializes to a stable `'interactive'` and applies
  the device default in a mount-once `useEffect`.
- **Honest kick-host test**: the "will not kick the host" test only tripped the self-kick guard. Added
  a test that puts a second `isHost` membership row under a different session id and asserts the kick
  is refused - exercising the `if (target?.isHost)` guard itself.
- **createRoom returns the host `playerId`**: a host reloading mid-game had `me === undefined` (roster
  poll skipped while running) and was bounced to Rejoin. `createRoom` now returns
  `{ room, playerId }` (mirroring `JoinResult`), threaded through the route and stored in the
  remembered membership.
- **Host roster badge shows mode**: the host row now reads "Host - Interactive" / "Host - Remote" so
  the roster shows whether the host holds the shared viewer.
- **Remote-host competing CTAs**: the in-game host control bar is now labelled "Host controls" and the
  advance "Next" button is de-emphasized (outline) while a question is answerable, so the player's
  answer Submit stays the clear primary.
- **Between-round remote copy**: a remote host now sees "Tap Next when you are ready for the next
  round" instead of "Waiting for the host to start the next round."
