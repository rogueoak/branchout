# 0037 - Host-controls accordion wrongly opened for turn/live games

## Symptom

The shared `GameStage` tucks the host controls (Next / Pause / Restart / Exit) into a canopy
accordion that is collapsed by default so it does not clutter the play screen (spec 0069). The
default-open rule keyed only on `autoAdvance`: it opened whenever `autoAdvance !== true`. Turn /
live games (Reversi, Checkers) advance themselves on each move and have NO host "Next" control, yet
they report `autoAdvance === false` (they never arm a leaderboard dwell). So they fell into the
"open" branch and showed an expanded, mostly-useless host-controls bar during play. The operator
wanted those games' controls collapsed by default.

An earlier attempt at a tri-state broke the finale for host-advanced round games (Sketchy, Zinger):
those ARE host-advanced (the host taps Next to drive the last leaderboard to the finale), so
collapsing them hid the required Next and stalled the game - their e2e (which clicks a visible
"Next" at the leaderboard) failed.

## Root cause

`autoAdvance === false` conflates two very different games: a round game the host drives with Next
(Sketchy/Zinger, and Trivia with the timer off) and a live/turn game that has no host Next at all
(Reversi/Checkers). Both report `autoAdvance === false`, so `autoAdvance` alone cannot decide
whether a host advance is pending. The missing signal was "is this a live/turn game?" - which the
engine already knows (`runtime.live`, i.e. the module implements `tick`) but never surfaced to the
client.

## Fix

Surface the engine's `runtime.live` on the `state` frame as a new optional, additive `live` field
(mirrored onto the client `GameState`, defaulting to `false` for a peer predating it). The
accordion now opens by default only when a host advance is genuinely pending:

```
openByDefault = !state.live && state.autoAdvance !== true
```

- Reversi / Checkers (`live: true`) -> collapsed.
- Trivia auto-advance on (`autoAdvance: true`) -> collapsed.
- Trivia auto-advance off, Sketchy, Zinger (`live: false`, `autoAdvance` off/null) -> open, so the
  required Next stays in reach - exactly the state the sketchy/zinger e2e depends on.

Covered by engine tests (the state frame carries `live: true` for a live game, `false` for a round
game), a reducer test, and GameStage component tests for the turn-game-collapsed and
host-advanced-open (Sketchy/Zinger) cases.

## Learning

"Is a manual host advance pending?" is not the same question as "is auto-advance off?". A live/turn
game has auto-advance off yet never needs a host Next. When a UI decision depends on a distinction
the engine already models (round-cycle vs live game), surface that authoritative signal on the wire
(additive, backward-compatible) rather than re-deriving it from a proxy like `autoAdvance` that
collapses the two cases. Rolled into `overview/learnings.md`.
