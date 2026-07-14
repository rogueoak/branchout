# 0045 - Per-game worker-thread isolation

## Problem

The game-engine runs every game in-process on its single main thread. The live physics game (Teeter
Tower, spec 0043) runs a ~25fps Matter.js `tick` loop synchronously on that thread (plus
`Query.collides` per move), so one heavy game - or a game with a bug that loops or crashes - stalls
WebSocket handling and starves every other room. There is no isolation boundary and no way to kill a
stuck game.

## Outcome

- Each running game (`room:game` session) executes in its **own Node `worker_thread`**, so game CPU
  is off the engine's main event loop: a physics game can no longer stall other rooms' frames.
- A **hung or crashed** game's worker is **terminated and the game auto-rebuilt from its last Redis
  snapshot**, resuming play - other rooms are unaffected and no operator action is needed.
- All three games play **identically** (no game-code change); the wire protocol is unchanged.
- A configurable **cap** bounds concurrent workers.

## Scope

**In:** a worker runtime + a session->worker manager on the main thread; rewiring every
`engine -> module` call to an async worker request; moving the live tick loop into the worker;
crash/hang containment + rebuild; the cap.
**Out:** multi-process/horizontal scaling; moving the phase/window timers into the worker (they stay on
the main thread); a shared worker pool (chosen: one worker per game); a warm-spare pool.

## Approach

### Split
- **Main thread (engine)** keeps all I/O + orchestration: sockets/HTTP, pub/sub, Redis persistence,
  the phase machine + move/dispute/guess window timers, host controls, reporting, and the per-session
  lock `run(key, fn)`.
- **Worker (one per session)** owns pure compute: the `GameModule` (built via `plugin.create`), its
  per-session in-process state (scratch + the live Matter world), and the live tick loop.

### Engine <-> worker protocol (`worker/protocol.ts`)
- **init** (engine->worker): `{ game }` -> the worker builds the module via `plugin.create(services)`
  (worker-safe services: rng=Math.random, forwarding logger, fs asset loader) and replies `ready`.
- **call** (engine->worker, request/response): `{ id, method, payload }` where `method` is any
  `GameModule` method (configure/startRound/collectMove/allSubmitted/reveal/collectVote/allDecided/
  resolveDecision/disputeWindow/disputeVote/leaderboard/advance/endGame) and `payload` carries the
  serializable `RoundContext` + params. Reply `{ id, ok, value }` or `{ id, ok:false, error }`.
  All payloads are already JSON-serializable (they persist to Redis today).
- **startTick / stopTick** (engine->worker): start/stop the worker's `setInterval(TICK_MS)` for a live
  game; the tick uses a stable ctx (`room`,`game` - the world is cached in the module).
- **sim** (worker->engine, unprompted): `{ scratch, sim, over }` each tick; the engine persists
  `scratch`, broadcasts `sim`, and on `over` runs the normal `endGame` path. A tick doubles as a
  liveness **heartbeat** for the watchdog.

### Session -> worker manager (`worker/manager.ts`, main thread)
- Spawns a worker on game start (keyed by `sessionKey`); `call(key, method, payload)` correlates by id
  with a **timeout**; tears the worker down on endGame/exit; enforces the **max-workers cap** (reject a
  new game past `WORKER_MAX`). Failure containment:
  - **crash** (`error`/`exit`): reject in-flight calls (engine falls back to the persisted Redis
    state); the next engine call/`startTick` respawns + the module rebuilds lazily from ctx scratch.
  - **hang**: a per-call timeout AND a tick heartbeat; on breach `worker.terminate()` (force-kills the
    thread) then respawn; rebuild is automatic - the module rebuilds its world from `ctx.scratch` on the
    next call (Teeter's lazy `worldFor`/`createWorld`; the seed is persisted in scratch, spec 0043).

### Determinism / rebuild
- `configure` derives + persists the seed once (spec 0043). A respawned worker never re-`configure`s;
  it rebuilds lazily from the existing scratch, so the world is identical. Turn-based games are pure
  over scratch - rebuild is just the snapshot.

### Boot / DI
- The main thread stops instantiating modules; instantiation moves into the worker. The main thread
  keeps each game's **manifest + configSchema** (static, no instance) for the `/sessions` handoff
  validation, or validates config in the worker on `configure` and returns the error.

## Acceptance

- [ ] Each game runs in its own worker thread; a physics game's CPU does not stall other rooms.
- [ ] A game whose worker is killed mid-play auto-rebuilds from its Redis snapshot and keeps streaming;
      other rooms are unaffected.
- [ ] All three games play end to end unchanged (unit + e2e); the wire protocol is unchanged.
- [ ] A configurable worker cap is enforced.
- [ ] `pnpm turbo typecheck lint test build` + `prettier --check .` green; CI e2e green.
