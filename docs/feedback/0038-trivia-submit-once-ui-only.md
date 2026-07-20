# 0038 - Trivia submit-once was UI-only and defeatable

## Symptom

The WS16 "you can only submit ONCE" / "I don't know fails the question" rule (spec `0069`) was
enforced only by local React state (`submittedRound` / `gaveUpRound`) in the Trivia remote. Because
the trivia engine's `collectMove` did `round[player] = answer` with no guard, a player could give up
(or answer wrong), RELOAD - which remounts the form because the lock lived only in component state -
submit again, and OVERWRITE their prior submission, scoring 100 after a give-up. A give-up (`''`) also
entered the dispute-eligible `wrong` set, so the player who pressed "I don't know" was still offered
the dispute button and an upheld dispute would have paid 50 points - the opposite of "you fail."

## Root cause

An authoritative game rule (single submission, and give-up = fail) was implemented at the presentation
layer only. The engine, the single source of truth for scoring, had no single-submit guard and treated
a blank the same as any wrong answer for dispute eligibility.

## Fix

- Engine (`packages/games/trivia`): `collectMove` now REJECTS a second submission for a player who
  already answered this round (`{ rejected: { reason } }`) instead of overwriting, so a reload/replay
  cannot change a give-up or a wrong answer into a scoring one. `reveal` excludes a blank/give-up from
  the dispute-eligible `wrong` set (it still shows red in the table via `correct: false`).
- Client (`apps/web` Trivia remote): locks the form on the engine rejection (`state.rejected`) after a
  reload, since the broadcast state carries no per-player "you answered" flag to lock upfront. Cost of
  the give-up is shown before the tap and the button is set apart from Submit (fat-finger mitigation).

## Learning

Generalized into `overview/learnings.md`: a rule that protects score/fairness must be enforced where
the truth lives (the engine), with the client as a mirror - never client-only. See that entry.
