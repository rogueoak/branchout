# 0069 - Trivia in-round, reveal, and leaderboard screens

## Problem

Trivia's setup got a glow-up (spec 0068: category/rounds/difficulty presets, auto-advance, and a
configurable answer time limit), but the three in-game screens a player actually stares at - the
question while answering, the answer reveal, and the between-round leaderboard - were still the
plain first-pass layouts. They do not use the new configurable pacing, and they read as flat: a
timer badge tucked in a corner, a reveal that buries the answer, and a leaderboard with no drama.

Who it is for: every Trivia player (mobile-web first), and the host who runs the room.

## Outcome

Three cohesive gameplay screens, driven by authoritative engine state and the host's spec-0068
pacing config:

- **In-round (question).** The question sits in a `Card` with the round + difficulty badges on
  top (the top timer badge is gone). Directly below it, a SMALL separate countdown `Card` whose
  number is sized a step under the question (WS16 - big enough to read, not a headline) and whose
  colour is a percentage of the configured time limit: neutral to start, `warning` at <=30%
  remaining, `danger` at <=10% with a fast custom blink (`animate-countdown-blink`, ~0.5s - quicker
  than `animate-pulse`; no blink under `prefers-reduced-motion`). An "x of y players answered" line
  updates live as answers land. Host controls collapse into an accordion, closed by default - but
  open by default when auto-advance is off, since the host must advance by hand.
- **Answering (submit-once + give-up, WS16).** A player answers each round exactly ONCE. After they
  Submit, the input and buttons are gone, replaced by a locked confirmation ("Answer locked in.")
  with no resubmit and no "you can change it" copy. Beneath the primary Submit sits a red ("I don't
  know") give-up: it submits the empty-answer sentinel, which the engine's matching scores wrong (no
  points), and locks the player out for that round exactly like any other submission. A give-up is
  just a wrong answer to the reveal / dispute flow; the answers table renders its blank as "No
  answer".
- **Reveal / answer.** The question shrinks; the answer is the focus, in strong colour. Nobody
  correct -> the answer is red; otherwise correct players read green and the rest red. Every
  player's guess is a Player | Answer table with a check / x per row. When auto-advance is on, a
  "Continuing in x seconds" countdown shows the dwell before the next hop.
- **Leaderboard.** A more exciting standings screen: podium emphasis for the top three, the
  player's own row called out, and - when auto-advance is on - the same "next round in x" dwell
  countdown.

All three keep the existing flow working: host advance still advances, auto-advance still auto
advances, and the flagship Trivia e2e still passes.

## Scope

**In**
- Shared in-round question `Card` (badges + question + big countdown + answered count), rendered by
  the viewer and by a remote-only controller.
- Percentage-based countdown colour + blink, honouring reduced motion.
- Live "x of y answered" indicator.
- Host-controls accordion with the auto-advance-aware default.
- Reveal answer emphasis + colour rules + answers table with verdict icons + dwell countdown.
- Leaderboard visual glow-up + optional dwell countdown (shared component, generic prop so other
  games are unaffected).
- The minimal engine/protocol additions that carry the pacing to the client (below).

**Out**
- Any change to scoring, dispute mechanics, or question selection.
- Reveal drama on a remote-only controller beyond what exists (the reveal screen is the shared
  viewer; the task targets it there).
- New design-system tokens.

## Approach

**Carrying pacing to the client.** The client is a pure view over engine `state` frames; today the
frame carries only `moveMsRemaining` (the answer window). Four additive, optional fields join
`StateMessage` (same `PROTOCOL_VERSION`, a reader treats absence as "unknown", exactly like
`disputes`/`moveMsRemaining`):

- `moveWindowMs` - the total configured answer window, so the client computes the countdown colour
  as a percentage of the whole, not a fixed second count.
- `autoAdvance` - true exactly when the engine is auto-advancing phases (the leaderboard dwell is
  armed). The in-round host-controls accordion collapses by default **only when this is `true`** -
  the sole case the host does not need the manual Next. When it is `false` or absent (a host-advanced
  game: Trivia with auto-advance off, OR a round game with no dwell at all like the insider games)
  the controls stay open, exactly as the plain host bar behaved before this feature. This graceful
  degradation is load-bearing: the finale and its `final-results` are **never gated behind the
  accordion** (the game-complete "Back to lobby" renders plainly), and a host-advanced game keeps its
  Next reachable so it can drive the last leaderboard to the finale.
- `autoAdvanceMsRemaining` - ms left in the current phase's auto-advance dwell (the reveal and
  leaderboard "continuing in x"), projected from the engine's authoritative `windowDeadline` the
  same skew-proof way as `moveMsRemaining`, **gated on `autoAdvance === true`** so a reconnect during
  a non-auto-advance dispute/voting/guess window never shows a bogus countdown. The engine **arms the
  dwell before publishing the entering `state` frame** (both the reveal and leaderboard transitions),
  so the frame that enters the phase carries the live deadline, not a stale ~0. Absent when no dwell.
- `answered` - during `collecting`, the number of connected players who have submitted this round;
  paired with the connected roster it renders "x of y". The engine cannot see the module's opaque
  submissions, so a new **optional** `GameModule.answeredCount(ctx)` reports it; Trivia implements
  it, every other game leaves it undefined (field absent). `submitMove` now re-broadcasts `state`
  on a successful answer so the count updates live.

Countdowns stay engine-authoritative: the visible number anchors the engine's remaining-ms to the
local clock (the existing `useMoveCountdown`), never a local guess. The dwell countdown re-anchors
on phase change so two equal-length dwells (reveal then leaderboard) do not run together.

**Components.** A shared `TriviaQuestionCard` (viewer + remote-only) holds the in-round card,
countdown, and answered line. A shared `AnswerReveal` holds the reveal emphasis + `Table`. The
between-round `Leaderboard` gains podium styling and an optional dwell-countdown prop. Reused
canopy: `Card` (twigs), `Accordion` + `Table` (branches), `Badge`. A small
`usePrefersReducedMotion` hook gates the blink and is unit-testable via `matchMedia`.

## Acceptance

- [ ] In-round: question in a `Card`; round + difficulty badges on top; no top timer badge.
- [ ] Countdown lives in its own small `Card` directly under the question, sized a step below the
      question; neutral, then `warning` at <=30% of the configured limit, then `danger` + fast blink
      (`animate-countdown-blink`) at <=10%; no blink under `prefers-reduced-motion`.
- [ ] Submit-once (WS16): after Submit the form is gone (no resubmit, no "you can change it" copy),
      replaced by a locked confirmation.
- [ ] A red "I don't know" give-up under Submit submits an empty-answer sentinel that scores wrong
      (no points) and locks the player out for the round; the reveal shows the blank as "No answer".
- [ ] "x of y players answered" reflects `answered` / connected roster and updates as answers land.
- [ ] Host controls sit in an accordion, collapsed by default, open by default when auto-advance
      is off.
- [ ] Reveal: smaller question; answer emphasized; red when nobody correct, else green for correct
      players and red for the rest; Player | Answer table with a check / x per row; "Continuing in
      x seconds" when auto-advance is on.
- [ ] Leaderboard: podium emphasis + own-row call-out; dwell countdown when auto-advance is on.
- [ ] Countdowns derive from engine remaining-ms (answer window + dwell), not a local timer guess.
- [ ] `pnpm --filter @branchout/web test`, lint, build, `pnpm format:check`, and the
      `@branchout/e2e` typecheck all pass; the Trivia e2e keeps its test-ids and still passes.
</content>
