# 0006 - Rooms, modes, orchestration and credit gating

## Problem

A game needs a place to gather and a referee for who may start it and whether they can afford it.
Branch out needs rooms that a host owns, that players and observers join, and a control-plane
that selects a game, checks the host's credit allowance, hands off to the engine, and turns the
results back into billing and stars. Nothing yet orchestrates a game from lobby to stars.

Depends on `0004` (a host is a signed-in account; players may be anonymous) and hands off to
`0007` (the engine + round protocol). It is the control-plane half of the game loop.

## Outcome

- A signed-in host creates a room with a short join code; host, players, and observers join it.
- Each player picks **interactive** or **remote** mode; the host can start only with at least one
  viewer present and enough credits for the rounds.
- On start the control-plane debits nothing yet but confirms affordability, hands the room and an
  opaque game config to the engine, and redirects players in.
- Each finished round reports back, debiting one credit and recording scoring; on game complete
  the final standings convert to stars.

## Scope

In:
- **Rooms** - a signed-in host creates a room and gets a **5-character** join code (uppercase
  ASCII letters and digits, with ambiguous characters like `O`/`0` and `I`/`1` excluded). The
  room also offers a **share link** of the form `/join?code=ABC12`, so a host can send one
  tap-to-join URL or read the code aloud. Members have a role: **host**, **player**, or
  **observer**. A room outlives a single game - play another match or pick a different game
  without recreating it.
- **Membership, presence, and mode in Redis** - who is in the room, who is connected, each
  player's chosen **interactive** or **remote** mode, and each player's **per-game nickname**
  (the display name they picked when joining; an account may override its default nickname here,
  an anonymous player just picks one). Room records and game history persist in **Postgres**.
- **Start rule** - starting a game requires **at least one viewer**: an observer, or an
  interactive player (a room of only remote players cannot start).
- **Game selection + start handoff** - the host selects a game (Trivia) and its config. The
  config is **opaque** to the control-plane: it validates only that a game is selected and passes
  the config through to the engine unchanged. On start, the control-plane runs the **credit
  allowance check** (below), then hands off to `0007` with the room and config; players are
  redirected into the game.
- **Host controls** - pause, restart, and exit (proxied to the engine), and **kick** a player or
  observer from the room. Kicking removes them from Redis membership, disconnects their session,
  and blocks a rejoin with the same session; the code still works for anyone else. Exit returns
  the room to the lobby state so it can host another game.
- **Round reporting intake** - an endpoint the engine calls with round results: debit one credit
  per round and record the round's scoring. On the game-complete report, convert final standings
  to **stars** (win 3, second 2, third 1 by default) and record them.
- **Credit ledger** - a minimal but real ledger in Postgres: a daily grant by tier (Free 10,
  Gathering 50, Party unlimited), a debit per round, and a balance-check function. The
  affordability check at start compares the requested round count against the balance and refuses
  to start more rounds than the balance covers.

Out:
- Purchases, billing UI, and tier changes (the **Purchases** spec). Friends and chat. Profiles
  (`0004` follow-up). The game's own logic and the round protocol internals (`0007`/`0008`).

## Approach

- **Redis vs Postgres split** - live membership, presence, and mode are ephemeral and high-churn,
  so they live in Redis keyed by room. The room's existence, its host, and completed game history
  are durable, so they live in Postgres. Anything that must survive a restart lands in Postgres.
- **Opaque config** - keeping the game config opaque keeps the control-plane out of every game's
  rules; it gates on credits and viewers only. The engine (`0007`) owns config validation. The
  control-plane stores the config blob with the game record for audit and restart.
- **Credit model** - a ledger of grant and debit entries; balance is the sum. The daily grant is
  idempotent per account per day (granting twice in a day is a no-op). One credit per round is the
  default cost; the round-report intake is the single place that debits, so a round is billed once
  and only when the engine confirms it ran. Party tier's unlimited balance short-circuits the
  affordability check.
- **Start handoff** - the affordability check runs before handoff; if it fails, start is refused
  with a clear reason and no engine call. On success the control-plane calls the engine's start
  endpoint (`0007`) with room + config and marks the game running.
- **Stars conversion** - the game-complete report carries final standings; the control-plane maps
  ranks to stars with the platform default and records them, re-checking the host's allowance
  before the next game.

## Acceptance

- [ ] A signed-in host creates a room with a 5-character code (no ambiguous characters) and a
      `/join?code=ABC12` share link; anonymous users can join as players or observers but cannot
      host, and each joiner picks a per-game nickname.
- [ ] A host can kick a player or observer: they are removed from membership, disconnected, and
      cannot rejoin on the same session; the code still works for others.
- [ ] Members hold a host/player/observer role; each player sets interactive or remote mode;
      membership, presence, and mode live in Redis and room/game history in Postgres.
- [ ] Start is blocked with no viewer present and allowed once at least one observer or
      interactive player is in the room.
- [ ] Start runs the affordability check (rounds vs balance; Free 10/day) and refuses to start
      more rounds than the balance covers, with a clear reason and no engine handoff.
- [ ] On start the opaque config is passed to the engine unchanged and players are redirected in;
      pause, restart, and exit reach the engine and exit returns the room to lobby.
- [ ] Each round report debits one credit and records scoring; the game-complete report converts
      standings to stars (3/2/1) and records them.
- [ ] The credit ledger grants by tier once per day (idempotent), debits per round in one place,
      and computes balance; Party is unlimited.
- [ ] Unit tests cover the start rule, the affordability check (afford, cannot afford, unlimited),
      idempotent daily grant, single-debit-per-round, and stars conversion including ties.
