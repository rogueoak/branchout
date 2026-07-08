# Plan 0013 - Host is a player

Source: `docs/specs/0013-host-is-a-player.md`.

Core move: collapse the mutually-exclusive `'host'` role into an `isHost` flag on a `'player'`
member, so the host flows through the existing player machinery (roster, join, answer, vote,
standings, stars) while `isHost` carries the admin powers. The game-engine needs no change - it is
already roster-driven; once the host is in the handoff roster it plays.

## Step 1 - Control-plane model (`apps/control-plane/src/rooms/membership.ts`)

- `Role` -> `'player' | 'observer'` (drop `'host'`).
- Add `isHost: boolean` to `RoomMember`. Update the doc comment on `mode` ("set for a player") to
  note the host is a player and so has a mode; observers have none.
- `isViewer` / `hasViewer` are unchanged in logic - the host, now a `player`, is a viewer exactly
  when its mode is `interactive`.

## Step 2 - Control-plane service (`apps/control-plane/src/rooms/service.ts`)

- `createRoom`: create the host as `{ role: 'player', isHost: true, mode: normalizeMode(undefined),
  ... }` (default `interactive`; the client refines from the device via `setMode`). Update the
  method doc.
- `setMode`: gate on `member.role === 'player'` (host qualifies); the "host has no mode" wording
  goes. (No code change to the predicate is strictly needed, but drop the stale comment/copy.)
- `members` redaction: `caller.isHost` sees `sessionId` (was `caller.role === 'host'`).
- `kick`: also refuse when the target member `isHost` (host is not kickable), on top of the
  existing self-kick guard. Load the target member to check the flag.
- `toHandoffPlayers`: keep the `role === 'player'` filter (now includes the host); update the
  comment to say the host plays and is intentionally included, observers still excluded.
- `requireHost` unchanged (authorizes against Postgres `hostAccountId`, independent of role).

## Step 3 - Web types + client membership

- `apps/web/lib/room-api.ts`: `Role` -> `'player' | 'observer'`; add `isHost: boolean` to
  `RoomMember`.
- `apps/web/lib/membership.ts`: add `isHost?: boolean` to the client `Membership` (sessionStorage).
- `apps/web/.../RoomsHome.tsx`: on create, remember `{ role: 'player', isHost: true, mode:
  defaultMode(navigator.userAgent) }` and call `setMode(code, that mode)` so the host's device
  default reaches the server. (createRoom seeds `interactive` server-side; this refines it.)

## Step 4 - Device-aware mode default (`apps/web/lib/default-mode.ts`, new)

- `defaultMode(userAgent: string): Mode`. TV UA (SmartTV, Tizen, Web0S/webOS, `AFT` Fire TV,
  GoogleTV, AppleTV, HbbTV, NetCast, BRAVIA, CrKey, PlayStation, Xbox) -> `interactive`; mobile UA
  (`/Mobi|Android|iPhone|iPad/`) -> `remote`; else `interactive`. Pure function of the UA string so
  it is unit-testable; callers pass `navigator.userAgent`. Best-effort, always overridable.
- Use it for the host initial mode (Step 3) and the join page initial mode (Step 6).

## Step 5 - Web RoomClient (`apps/web/app/rooms/[code]/RoomClient.tsx`)

- `isHost` -> `membership?.isHost ?? false` (was `role === 'host'`).
- `me` for the host: `members.find((m) => m.isHost)?.playerId ?? membership?.player` (was
  `m.role === 'host'`).
- No change to the engine-connect path: it already builds `gameOptions` from `me` and sends `join`
  once `running`; the host's join simply starts succeeding once it is in the roster. (Verify this in
  the browser/tests - it is the whole point.)

## Step 6 - Web Lobby + JoinForm + GameStage

- `Lobby.tsx`: `memberLabel` -> `if (member.isHost) return 'Host'` (keep observer/mode labels; a
  host row reads e.g. "Host"). Kick button condition -> `isHost && !member.isHost`. The existing
  `role === 'player'` mode picker now also renders for the host (desired - the host picks mode in
  the lobby); the host additionally sees the config/start panel. Local `hasViewer` unchanged (host
  is a player). Consider showing the host's mode alongside the "Host" badge.
- `JoinForm.tsx`: initial mode `useState<Mode>(() => defaultMode(navigator.userAgent))` instead of
  the hardcoded `'interactive'`. Role/mode payload logic unchanged (join still only creates
  player/observer).
- `GameStage.tsx`: no logic change needed - it already keys panes on `role`/`mode` and renders
  `HostControls` on `isHost`. With the host now `role: 'player'`, it renders by mode (interactive =
  viewer+remote, remote = controller) plus the controls overlay. Update only if a `role === 'host'`
  assumption is hiding (none found in the map). Optionally badge the host row in the leaderboard.

## Step 7 - Tests (before commit)

Control-plane (`apps/control-plane/src/rooms/service.test.ts`):
- Host is created as `role: 'player', isHost: true` with a mode.
- **Seam:** after `start`, `engine.starts[0].players` contains the host's `playerId` + nickname and
  does NOT drop it (the load-bearing "host reaches the engine as a player" assertion - learnings:
  test the mapping at the seam). Observers still excluded.
- A solo interactive host passes the viewer gate and can `start`; a remote-only host with no other
  viewer fails with `no_viewer`.
- `setMode` works for the host and changes its mode.
- `members`: the host still sees `sessionId`; a non-host still redacted.
- `kick`: the host is not kickable (self and by-flag); a player still is.

Web:
- `default-mode.test.ts` (new): the matrix - a sample mobile UA -> `remote`, a sample TV UA ->
  `interactive`, a desktop UA -> `interactive`.
- `GameStage.test.tsx`: update the host case to `role: 'player', isHost: true, mode: 'interactive'`
  (renders viewer + remote + controls) and add `role: 'player', isHost: true, mode: 'remote'`
  (controller + controls, no viewer). Prove the host can answer (answer UI present).
- `room-api.test.ts`: `RoomMember` mocks carry `isHost`; drop any `role: 'host'`.

End-to-end (repo pattern = integration Vitest, no browser harness): the control-plane seam test
above plus the engine's existing full-lifecycle standings test together prove a host-origin roster
player plays a full game and lands in the final standings with stars. If the engine lifecycle test
does not already assert a named roster player in `game-complete` standings, extend it to.

## Step 8 - Verify green, then commit + PR

- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (or the turbo equivalents) all green in
  the worktree before commit.
- Grep the whole repo for any remaining `'host'` role literal / `role === 'host'` and confirm each
  is intentionally gone or migrated to `isHost`.

## Files touched

- `apps/control-plane/src/rooms/membership.ts`, `service.ts`, `service.test.ts`
- `apps/web/lib/room-api.ts`, `membership.ts`, `default-mode.ts` (new), `default-mode.test.ts` (new)
- `apps/web/app/rooms/[code]/RoomClient.tsx`, `apps/web/.../RoomsHome.tsx`
- `apps/web/components/game/Lobby.tsx`, `GameStage.tsx`, `GameStage.test.tsx`,
  `apps/web/app/join/JoinForm.tsx`, `apps/web/lib/room-api.test.ts`
- (maybe) `apps/game-engine/src/engine.test.ts` to assert a named player in final standings

## Verification

Each acceptance box in the spec maps to a test above. Manual smoke (optional, via the local docker
stack): create a room on a laptop (defaults interactive, plays + controls), a phone joins (defaults
remote), start, both answer, both appear in the final standings.
