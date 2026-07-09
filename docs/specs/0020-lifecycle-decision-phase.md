# 0020 - Round lifecycle: submission rejection + a generic guess/decision phase

## Problem

The engine's round lifecycle is shaped around Trivia: after `reveal` it always runs the
`disputing -> voting` dispute flow. The next game, Liar Liar (a bluffing game), needs a different
post-reveal shape - players see all the submitted answers and then **guess** which is the truth -
and it needs to **reject a submission** in real time (you cannot submit a duplicate or the correct
answer). These are generic harness capabilities, not Liar-Liar specifics, and today the harness
offers neither.

This spec adds them **surgically**: Trivia's `disputing/voting/dispute` path and the answer-window
timer (spec 0017) are left completely untouched; the new capabilities are additive and opt-in, so no
existing game changes behavior. Liar Liar's engine plugin (spec 0021) builds on them.

## Outcome

- A game module can **reject a single submission** back to the submitting device only: `collectAnswer`
  may return `{ rejected: { reason } }`, and the engine replies to that one socket with a new
  `answer_rejected` frame (nothing is broadcast, no scratch is written). Trivia never rejects, so it
  is unaffected.
- A game can request a **generic post-reveal "guess" phase** instead of the dispute flow: `reveal`
  may return `{ decision: { windowMs } }`. When it does, the engine enters a new `guessing` phase
  (streaming the reveal as the guessable options), collects choices via the existing `vote` frame,
  closes on all-guessed or the timer, then calls `resolveDecision` to score and produce the final
  reveal. A game that returns no `decision` (Trivia) takes the unchanged dispute path.

## Scope

In:
- **`@branchout/game-sdk`**: `ScratchResult` gains optional `rejected?: { reason: string }`;
  `RevealResult` gains optional `decision?: { windowMs?: number }`; `GameModule` gains optional
  `resolveDecision?(ctx): DecisionResult` and `allDecided?(ctx): boolean`. All additive/optional.
- **`@branchout/protocol`**: add `'guessing'` to the `Phase` union (and `PHASES`); add a server frame
  `AnswerRejectedMessage { type: 'answer_rejected', room, game, round, reason }` to `ServerMessage`.
  Additive under the same `PROTOCOL_VERSION`.
- **Engine**: `submitAnswer` returns the reject frame (or nothing) so the socket can send it to the
  one connection; `SessionState` gains `decisionWindowMs`; `advanceLocked` branches after `reveal`
  on `result.decision` (-> `guessing`, arm a window with `decisionWindowMs`) vs the existing dispute
  path; a new `guessing` case runs `resolveDecision` then `finalizeRound`; `submitVote` accepts the
  `guessing` phase and early-closes on `allDecided`; pause/resume and host-reconnect re-arm the
  `guessing` window like the dispute window.
- **Socket**: on an `answer`, if the engine returns a reject frame, send it back on that connection.
- **Tests**: SDK/engine fixture exercising the decision path (a `deciderGame`/`deciderPlugin` in
  `@branchout/game-sdk/testing`); engine tests for the guess phase (enter/collect/all-decided
  early-close/timer-close/score/finalize, pause-resume) and for submission rejection (rejected
  submit sends the frame to the sender and writes no scratch). All existing Trivia/dispute/answer-
  window tests stay green unchanged.

Out:
- Liar Liar's game logic and content (specs 0021/0022). Any client rendering of `guessing` or
  `answer_rejected` (the game-pluggable web client, spec 0023). Migrating Trivia's dispute/vote onto
  the decision loop - deliberately not done, to keep the live game untouched (a future unification if
  ever wanted).

## Approach

- **Opt-in, additive, zero-touch to Trivia.** Every new field/hook is optional; the engine only takes
  the new branch when a module returns `decision`/`rejected`. The dispute path, the answer-window
  timer, and their tests are unchanged.
- **Guess window mirrors the dispute window, not the answer window.** The `guessing` timer re-arms
  the full window on resume (like `disputing/voting`) rather than freezing remaining ms (the answer
  window's richer behavior). A 30s guess does not warrant the extra state; the client runs its own
  local visual countdown, as it already does for the 10s dispute window. So no new `state` timer
  field is added.
- **Rejection is a targeted reply, not a broadcast.** A rejected fake must reach only its author (and
  vaguely - "someone already submitted that"), so `submitAnswer` returns the frame and the socket
  sends it on that connection; it never goes through pub/sub and never mutates session state.
- **`vote` frame is reused for the guess.** The guess is a choice among revealed options, carried by
  the existing `vote` frame's `target`; the module owns what it means in the `guessing` phase, exactly
  as it already owns dispute vs ballot in `disputing`/`voting`.

## Acceptance

- [ ] A module returning `{ rejected: { reason } }` from `collectAnswer` causes the engine to send an
      `answer_rejected` frame to the submitting connection only, with no scratch write and no
      broadcast; a normal submit is unchanged.
- [ ] A module whose `reveal` returns `{ decision: { windowMs } }` drives
      `collecting -> reveal -> guessing -> (resolveDecision) -> leaderboard`, closing `guessing` on
      all-decided or the timer, with scores applied from `resolveDecision`.
- [ ] Trivia is byte-for-byte behavior-identical: no `decision`, no `rejected`, dispute/vote and the
      answer window unchanged; every pre-existing engine/trivia test passes untouched.
- [ ] Pause/resume and host-reconnect re-arm the `guessing` window correctly.
- [ ] `pnpm build && typecheck && test && lint && format:check` green across the workspace.
