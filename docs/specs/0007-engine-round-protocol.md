# 0007 - Game engine and round protocol

## Problem

Branch out needs the engine that runs games and the shared contracts that let players, the
engine, and the control-plane speak the same language. Without a game registry, session state, a
device connection, and a typed protocol, no game can run and `0006`'s handoff has nowhere to go.

This is the first spec of the game-engine group, so it owns the shared `packages/protocol` setup
that `0008` and the later engine specs reference. It consumes `0006`'s start handoff and reports
results back to it; `0010` is its player-facing client.

## Outcome

- `packages/protocol` holds shared TypeScript types and message contracts for both channels: a
  player-to-engine WebSocket channel and a server-to-server engine-to-control-plane channel.
- The engine runs a game selected by module from a registry, holds its session state in Redis,
  accepts device connections, streams updates, and handles host controls.
- A game module drives the generic round lifecycle and emits scoring events and final standings,
  which the engine reports to the control-plane for billing and stars.

## Scope

In:
- **`packages/protocol`** - the shared contract package, two channels:
  - **Player <-> engine (WebSocket)** - client sends: join session, submit answer, submit vote.
    Server sends: prompt, reveal, leaderboard, and state (current phase, players, scores). Every
    message is a typed, versioned envelope keyed by room/game and player.
  - **Engine <-> control-plane (server-to-server)** - start handoff (room + opaque config in),
    round result (per-round scoring out), and game-complete standings (final ranks out). See the
    Approach for the transport decision.
- **Engine skeleton** (`apps/game-engine`, Express + WebSocket):
  - A **modular game registry**: a game is a module implementing a lifecycle interface; the engine
    resolves the selected game by id and drives it. Adding a game is registering a module.
  - **Session state in Redis** keyed by room/game: phase, players, scores, and per-game scratch
    space, for the life of the game.
  - **Device connect + streaming**: players connect over WebSocket, are bound to a room/game and
    player identity, and receive streamed prompt/reveal/leaderboard/state updates via Redis
    pub/sub.
  - **Host-control handling**: pause, advance, restart, and exit, applied to the running session.
- **Generic round lifecycle** the engine exposes and a game module implements:
  `configure -> startRound -> collectAnswers -> reveal/score -> disputeWindow -> disputeVote ->
  leaderboard -> advance`, plus `endGame`. The engine sequences the phases and streams state; the
  module fills in the game-specific behavior.
- **Generic scoring** - a scoring-event emission (points to a player, with a reason) and a
  final-standings shape, both game-agnostic. The engine forwards round results and standings to
  the control-plane (`0006`).

Out:
- Any specific game's logic - question draw, answer matching, dispute rules - that is `0008`.
  Matchmaking. The lobby and in-game UI (`0010`). Credits, billing, and stars math (`0006`); the
  engine reports, it does not bill.

## Approach

- **`packages/protocol` as the source of truth** - both the WebSocket messages and the
  server-to-server calls are typed here so web, engine, and control-plane import one contract and
  drift is a type error, not a runtime surprise. Version the envelope from day one so a message
  shape can change without breaking older clients.
- **Server-to-server transport** - use **internal REST** for engine-to-control-plane (start
  handoff as a call into the engine, round result and standings as calls into the control-plane).
  Trade-off: REST is simple, debuggable, and already how the services front their APIs; a message
  queue would decouple and buffer but adds infrastructure Branch out does not yet need at this
  scale. Make the calls idempotent (a round result carries a round id) so a retry does not double
  bill. Revisit a queue if reporting volume outgrows request/response.
- **Lifecycle interface** - the engine owns phase sequencing, timers (for example the dispute
  window), streaming, and host-control application; the game module owns what each phase means.
  This split lets `0008` be pure game logic and keeps the registry the only place games plug in.
- **Redis for session state and pub/sub** - live game state is ephemeral and streamed to many
  devices, so Redis holds it and carries the fan-out. Nothing here writes Postgres directly;
  durable records come from the control-plane reacting to reports.

## Acceptance

- [ ] `packages/protocol` exports typed, versioned contracts for both the player-to-engine
      WebSocket messages and the engine-to-control-plane server-to-server calls, imported by web,
      engine, and control-plane.
- [ ] The engine registers games in a modular registry and resolves the selected game by id; a
      stub game module drives the full lifecycle end to end in a test.
- [ ] Session state (phase, players, scores) persists in Redis keyed by room/game for the life of
      the game and is recovered on reconnect.
- [ ] A device connects over WebSocket, is bound to a room/game and player, and receives streamed
      prompt/reveal/leaderboard/state updates.
- [ ] Host controls (pause, advance, restart, exit) apply to the running session and reach
      connected devices.
- [ ] The engine forwards round results and final standings to the control-plane over the chosen
      transport with an idempotent round id; the transport decision is recorded.
- [ ] Unit/integration tests cover registry resolution, the lifecycle sequencing, scoring-event
      emission, reconnect state recovery, and idempotent round reporting.
