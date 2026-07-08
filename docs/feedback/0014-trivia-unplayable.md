# 0014 - Trivia was unplayable end to end

## Symptom

Playing a real round exposed five defects that together made Trivia not work. The first two hid
behind the others; each was only found once the one before it was fixed and a real round could
progress further.

1. **Start failed with a 500.** Clicking "Start game" returned `500 Internal Server Error`
   from `POST /rooms/:code/start`, with nothing logged on the control-plane.
2. **Nobody saw the question.** Even when start succeeded, no player - host included - ever
   saw the prompt. The viewer showed "Get ready" forever; the round looked frozen.
3. **Non-host players never advanced.** A player who joined then watched the host start the
   game sat in the lobby and never entered the game at all.
4. **Even a delivered prompt did not render.** Once the prompt reached the client, the viewer
   *still* showed "Get ready" - the client silently rejected the payload.
5. **The host could not identify itself for pause.** Host-disconnect never paused the game
   because the engine's roster had every player as `isHost: false`.

Remote-only players were additionally answering blind: the controller never rendered the
question text, only the answer box.

## Root cause

1. **The control-plane never knew where the engine was.** `config.ts` defaults
   `engineUrl` to `http://localhost:4001`, but in Docker (and in production) the engine is a
   separate container reached at `game-engine:4001`. No compose file set `ENGINE_URL`, so the
   handoff `fetch` hit the control-plane's own port and threw `ECONNREFUSED`. That error is a
   `TypeError`, not an `EngineError`, so `withSession` re-threw it as an unmapped 500 instead
   of the intended 502 - and logged nothing.
2. **The prompt was streamed but never persisted, and it was published before any device was
   subscribed.** `startRoundInto` publishes the `prompt` frame to the session's pub/sub channel
   at handoff time - before the host's browser has even opened its WebSocket. Redis pub/sub only
   delivers to *current* subscribers, so that first prompt is lost for everyone. `engine.join`
   then returns a `state`-only snapshot (phase/round/scores) with no prompt, so a joining or
   reconnecting device has no way to recover the current question. `state.prompt` stays `null`
   and the UI has nothing to render.
3. **The web client never polled the room status.** The lobby poll fetched only `/members`,
   never the room, and `running` flipped true only inside the host's own start handler. A
   non-host device runs no such handler, so it never learned the game started, never opened the
   engine socket, and sat in the lobby forever. (The engine catch-up in cause 2 is necessary but
   not sufficient: a device that never connects gets nothing to catch up on.)
4. **The client's prompt decoder demanded the wrong type.** `asTriviaPrompt` required
   `typeof difficulty === 'number'`, but the engine puts the *question's* difficulty on the
   prompt - a tier string (`'easy' | 'medium' | 'hard'`), not the host's numeric 1-10 setting.
   Every real prompt failed the guard and decoded to `null`, so the UI rendered nothing. The web
   test mocked `difficulty: 5` (a number), so it passed while reality failed.
5. **`isHost` was dropped at the ingress boundary.** The flag was added to the roster and sent
   by the control-plane, but the engine's `parseStartHandoff` -> `requirePlayers` rebuilt each
   player as `{ player, nickname }`, silently discarding `isHost`. The type, the sender, and the
   consumer all agreed; the *validator* in between did not carry the field, so the engine's
   roster was always `isHost: false` and host-disconnect never paused.

Remote-only blindness is a separate UI gap: `RemotePane` renders the answer box but never the
prompt, and a remote-only player has no viewer pane beside it, so the question is nowhere on
their screen.

## Fix

1. Set `ENGINE_URL=http://game-engine:4001` on the control-plane in both `infra/docker-compose.yml`
   and `deploy/docker/compose.site.yml`, and wrap engine-client network failures as
   `EngineError(..., 502)` so an unreachable engine is an observable 502, not a silent 500.
2. Persist the current round's `prompt`, `reveal`, and `standings` in `SessionState` (set in
   `startRoundInto`/`reveal`/`finalizeRound`/`endGame`, cleared on a new round). Return an ordered
   list of catch-up frames from `engine.join` - `[prompt?, reveal?, leaderboard?, state]` - so a
   joining or reconnecting device is handed the current question and results, then streams live
   from there.
3. Add a `GET /rooms/:code` room-view endpoint and poll it in the lobby alongside `/members`, so a
   non-host device sees `status` flip to `running`, opens the engine socket, and enters the game.
4. Type `TriviaPrompt.difficulty` as the tier string the engine sends and accept
   `typeof difficulty === 'string'` in `asTriviaPrompt`; fix the web mocks to use a tier so the
   test reflects reality.
5. Carry `isHost` through `requirePlayers` (optional, defaulted-absent), map it through
   `toHandoffPlayers`, store it on the engine's `SessionPlayer`, and auto-pause/resume on the
   host's disconnect/reconnect (spec `0014`).
6. Render the prompt at the top of `RemotePane` during `collecting` when it is the only pane on
   screen (`showResults`), so a remote-only player sees what they are answering.

## Learning

- **A frame you only ever *stream* is invisible to anyone not subscribed at the instant you send
  it.** Live game state that a late joiner or a reconnecting device must recover has to be
  *persisted* and *replayed on join*, not just published once. Publish-before-subscribe is not a
  race you can tune away; the join path must reconstruct the current phase from stored state.
- **Wrap a cross-service network call so an unreachable peer is a mapped, logged error, not a raw
  throw.** A bare `fetch` that rejects on connection refusal surfaces as an unhandled 500 with no
  log line; catch it at the client boundary and map it to the same error type an HTTP-level
  failure uses.
- **A default that only works when two services share a host is a trap in a split deployment.**
  Defaulting `engineUrl` to `localhost` passes every single-process test and fails the moment the
  services live in separate containers. Wire the real address in the environment that runs them
  apart, and don't let a convenience default stand in for deployment config.
- **A field wired end to end can still die at the validator in the middle.** `isHost` had a type,
  a sender, and a reader that all agreed, yet it was `false` everywhere because the ingress parser
  reconstructed the object field-by-field and did not copy it. When you add a field to a message,
  add it to the *parser* too, and pin it with a round-trip test through the actual validator - the
  seam, not just the two ends.
- **A mock that is easier to write than the real payload will hide a decoder bug.** The prompt
  test used `difficulty: 5` because a number is the obvious placeholder, but the engine sends a
  tier string; the guard rejected reality while the test stayed green. Mock the shape the producer
  actually emits (copy a real frame), not the shape that is convenient to type.
- **A client that transitions state off its own action must also poll for the same transition
  driven by someone else.** The room went `running` in the actor's (host's) handler, so only the
  actor advanced; every other device needed to *observe* the change and had no way to. When one
  peer's action changes shared state, give the other peers a read to detect it (poll or push) -
  do not assume they took the same code path.
- **"The message arrives" and "the UI updates" are two assertions.** The engine delivered the
  prompt (provable at the socket) yet the screen stayed blank because the decoder dropped it. Test
  through to the rendered surface, not just to the wire; a frame received is not a question shown.
