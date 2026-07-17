# 0050 - Lobby modes, viewers, and player limits

## Problem

The room lobby's setup was confusing and had friction:

- **A standalone "invite your friends" step** sat between picking a game and the lobby, even though
  the lobby already shows the share link - pure friction on the create flow.
- **The mode picker ("Your setup")** offered only Interactive / Remote, and nobody knew what those
  meant. Watching-only was a separate "observer" role chosen at join, disconnected from the mode.
- **No player limits.** Any number of players could join any game, and there was no notion of a
  minimum (Liar Liar needs at least two) or a maximum.
- The join-code input auto-focusing on the rooms home popped the mobile keyboard (feedback 0031).

Who it's for: anyone hosting or joining a room - especially a group gathered around one shared
screen with phones as controllers.

## Outcome

- **Unified mode.** `role` (`player`/`observer`) and `mode` (`interactive`/`remote`) collapse into a
  single `mode` every member has: `viewer` | `interactive` | `remote`.
  - **Viewer** - watches only; a shared screen. Never plays, never counts toward player limits or
    paid rounds. (Replaces the old `observer` role.)
  - **Interactive** - shows the game on this screen AND plays (screen + controller together).
  - **Remote** - plays with a controller only; needs another device to show the game.
  - `interactive`/`remote` are the PLAYING modes; `viewer`/`interactive` are the DISPLAY (screen)
    modes. A game needs at least one display member to start.
- **The mode picker lives only in the lobby** ("Your mode"), each option carrying a one-line
  description. The join page just asks for a nickname; mode is defaulted and refined in the lobby.
- **Per-game player limits** (shared `@branchout/protocol` constant, so client UI and server
  enforcement never drift): Trivia 1-8, Liar Liar 2-8, Teeter Tower 1-4. Viewers are excluded from
  the count.
  - At the **maximum**, a joiner requesting a playing mode is clamped to `viewer` (server), and the
    lobby disables the Interactive/Remote options.
  - Below the **minimum**, Start is blocked (server + lobby) with a clear reason.
- **Default mode** (device-aware, always overridable), in priority order: (1) the device's last
  chosen mode (localStorage); (2) if the room has no interactive member yet -> interactive; (3) a
  second join from this device -> viewer; (4) a mobile device -> remote; (5) otherwise interactive.
- **Lobby layout**: Invite friends -> Your game -> Who is here -> Your mode -> Game Setup (the config
  panel + Start).
- **The invite step is removed**; a first game pick drops straight into the lobby.
- The rooms-home join-code input does not auto-focus (guard kept from feedback 0031).

## Approach

- **Model (server, `@branchout/control-plane`):** drop `Role`; `Mode = 'viewer' | 'interactive' |
  'remote'` on every `RoomMember`. Helpers `isDisplay`/`hasDisplay` (screen present), `isPlaying`/
  `playingCount` (roster + limits). Membership stays Redis-only (no DB migration).
  - `join` normalizes the requested mode and clamps a playing mode to `viewer` when the selected
    game is already at its max (the caller's own seat excluded, so a rejoin is not double-counted).
  - `setMode` refuses switching to a playing mode when full (`room_full`); viewer is always allowed.
  - `start` gates on `hasDisplay` (`no_viewer`) and `playingCount >= min` (`too_few_players`).
  - The engine handoff roster includes only playing members (viewers never fill the roster).
- **Shared limits:** `PLAYER_LIMITS` + `playerLimits(gameId)` in `@branchout/protocol`, imported by
  both the web lobby and the control-plane.
- **Web:** `room-api`/`membership` carry the unified `Mode`; `default-mode` takes a context (previous
  mode, has-interactive, rejoining, user-agent) and returns the precedence above; `Lobby` renders the
  three-mode picker with descriptions, the reordered layout, and the min/max enforcement; `GameStage`
  keys its layout off `mode` alone; `JoinForm` collects only a nickname.

## Known limitations / follow-ups

- The join page cannot see the room roster before joining, so the "no interactive member yet ->
  interactive" default (rule 2) is applied only for the host at create time; a joiner relies on the
  device/rejoin rules and refines in the lobby. A roster-aware join default is a follow-up.
- Viewers already do not count toward paid rounds; per-player billing is still future work (credits
  are currently free, spec 0050's credit change notwithstanding).
- The insider game set is still duplicated in the control-plane (`INSIDER_GAME_IDS`); folding it into
  the shared games module alongside `PLAYER_LIMITS` is a natural next step.
