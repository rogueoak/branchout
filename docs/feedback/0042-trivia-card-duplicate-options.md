# 0042 - Trivial Matters question card duplicated the answer options

## Symptom

On a multiple-choice or true/false round, the answer choices showed up TWICE: as a read-only list on
the shared question card (the viewer's `TriviaQuestionCard`) AND as the tappable buttons on the
controller (`Remote`). An interactive player (viewer + controller on one screen) saw both at once,
which read as confusing duplication - "why are the options listed here and also as buttons?".

## Root cause

Spec 0074 rendered a read-only option list inside `TriviaQuestionCard` (for MC: the four choices; for
TF: True / False) on the theory that a shared-screen viewer with no controller beside it would want to
read the options. But every player already gets the choices as buttons on their own controller (the
button label IS the full option text), so the card copy was redundant everywhere a controller is
present - i.e. for every player.

## Fix

Remove the option list from `TriviaQuestionCard` entirely. The card now shows only the prompt, the
round-type/category/difficulty badges, and the countdown; the choices live solely as the tappable
buttons on `Remote`. Open rounds were unaffected (they never showed options). Unit tests updated to
assert the card/viewer no longer render an "Answer options" list while the Remote buttons stay.

## Lesson

When the same information has an INTERACTIVE affordance (a button carrying the full label) and a
passive display in the same viewport, the passive copy is redundant, not helpful - show each choice
once, as the thing the player acts on. "The shared viewer might want it" only holds for a pure
spectator screen with no controller; do not pay a duplication cost on every real player's screen for
that edge.
