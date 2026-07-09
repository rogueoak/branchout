# 0017 - Answer round: 60s timer + reveal every answer

## Problem

The answer round has no visible clock and no shared view of what people said. A round only closes
when everyone submits (2s grace, feedback 0015) or the host advances - so a slow or distracted
table can stall, and there is no urgency. And at reveal, players see who was right or wrong but
never *what each player actually answered* - half the fun of trivia (the funny near-misses) is
invisible.

## Outcome

- Each question shows a **60-second countdown**. When it hits zero the player's typed answer is
  **auto-submitted** and the round closes. The countdown is the same for everyone (engine-driven
  deadline) and the engine enforces it even if a client misbehaves.
- At reveal, **everyone sees every player's submitted answer** alongside the accepted answer and
  the correct/wrong verdict.

## Scope

In:
- **Answer window**: the engine arms a 60s deadline when a round opens (`collecting`), force-closing
  to reveal when it expires; the existing "everyone answered -> 2s" early close still applies, so 60s
  is the ceiling, not a floor. Pausing freezes the clock and resuming re-arms it (mirrors the
  dispute-window pause/resume).
- **Deadline on the wire**: the `state` frame carries an optional `answerDeadline` (epoch ms) so
  every client counts down to the same instant and a reconnecting device shows the true remaining
  time, not a fresh 60s.
- **Client countdown + auto-submit**: the viewer and the controller show the seconds remaining; at
  zero the controller submits the current draft (if non-empty). A paused game shows the clock held.
- **Reveal all answers**: the reveal payload gains a per-player `submissions` list (player, their
  answer, correct); the viewer renders each player's answer with a correct/wrong marker.

Out:
- Per-player custom time limits, extensions, or a configurable duration (60s is fixed this spec).
- Scoring changes (still 100 for correct; the timer does not add speed bonuses).
- Showing answers on the private controller (the shared viewer is where the table looks).

## Approach

- **Clock seam**: inject `clock: () => number` into the engine (default `Date.now`), like the
  existing `scheduler` seam, so deadline math is deterministic under test. `ConfigureResult` gains
  `answerWindowMs?` (Trivia returns 60_000; absent/0 means no timer, preserving the stub's behavior).
- **State**: `SessionState` holds `answerWindowMs`, `answerDeadline`, and (while paused) the frozen
  `answerRemainingMs`. `startRoundInto` sets the deadline and arms a scheduler timer that advances
  `collecting -> reveal`, guarded on phase/round/runId/pause at fire time (same guard style as the
  auto-advance and dispute-window timers). Pause cancels and stores remaining; resume recomputes the
  deadline and re-arms.
- **Reveal**: `reveal()` already holds each player's submission; add a `submissions` array
  (player + answer + correct) to the payload. Additive to the opaque reveal shape.
- **Client**: the reducer stores `answerDeadline` from the `state` frame (absence = no timer). A
  small tick hook recomputes seconds remaining each second from the deadline; the controller
  auto-submits at zero. The viewer's reveal maps `submissions` to nickname + answer + marker.

## Acceptance

- [ ] A round opens with a 60s deadline; when it expires the engine advances to reveal even if no
      one submitted, and a client's typed draft is auto-submitted at zero.
- [ ] Everyone answering early still closes the round in ~2s (unchanged); 60s is the ceiling.
- [ ] Pausing during the answer round holds the countdown; resuming continues from the remaining
      time, not a fresh 60s, and the round does not close while paused.
- [ ] The `state` frame carries `answerDeadline`; a reconnecting device shows the true remaining
      time. The field is optional/additive (a peer without it just shows no timer).
- [ ] The reveal shows every player's submitted answer with a correct/wrong marker.
- [ ] Unit/UI tests cover: the 60s force-close, pause/resume re-arm, auto-submit at zero, the
      deadline on the state frame + reducer, and the per-player answer reveal.
