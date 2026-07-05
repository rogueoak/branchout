# 0008 - Trivia game

## Problem

Branch out needs its first real game to prove the platform end to end: a host configures it,
players answer, the engine scores and streams updates, results become stars. Trivia is that
game - a classic, broadly appealing party game that exercises rounds, scoring, live updates, and
a social twist (disputes).

Depends on: `0007` (game engine + round protocol), `0009` (question bank), `0006` (rooms), and
consumes them. The player-facing UI is `0010`; this spec is the engine-side game logic and its
rules.

## Outcome

A host can start Trivia from a room, configure it, and play it through to a winner, with the
engine driving each round over the `0007` protocol and reporting results for scoring and stars.

## Scope

In (the game logic and its contract):
- **Configuration** the host sets before start:
  - **Category**: one of `Nature, Food, Animals, Science, People, Places, Things, History`, or
    `Random` (draw from all categories).
  - **Rounds**: integer 1 to 100, default 10. Reject out of range.
  - **Difficulty**: integer 1 to 10, default 5. Controls the blend of easy/medium/hard questions
    drawn (table below).
- **Round play**: one question per round. The engine sends the prompt; every player submits a
  free-form text answer within the round; a correct answer scores **100 points**.
- **Answer matching**: normalize both the player's text and each acceptable answer (lowercase,
  trim, collapse inner whitespace, strip a leading article `a/an/the`, drop punctuation), then
  match. See "Answer matching" for the tolerance decision.
- **Dispute window**: after answers are revealed, players have **10 seconds** to dispute (a
  player who was marked wrong and disagrees). If one or more players dispute, the disputed
  answer goes to a vote of the **remaining** players (everyone except the disputer). If a
  **majority of those other players** agree the answer was mostly correct, the disputer is
  awarded **50 points**. Ties or no-majority mean no award.
- **Between rounds**: a pause showing the **leaderboard**; the host clicks to advance to the next
  round. The game does not auto-advance.
- **End of game**: the player with the most points wins. Final standings are reported to the
  control-plane, which converts them to stars (win 3, second 2, third 1 by the platform default).
- **Question selection**: draw per-round from `0009` honoring the difficulty blend, never
  repeating a question within a game; `Random` draws across all categories.

Out:
- The question data itself (`0009`), the room/lobby and host controls UI (`0010`), the generic
  round protocol and credit/stars plumbing (`0007`/`0006`). No per-question timers beyond the
  dispute window in this spec (a submit timer can be added later; call it in review if you want
  one now).

## Approach

- Implement Trivia as a module in the modular game registry from `0007`, exposing the round
  lifecycle the protocol defines: `configure -> startRound -> collectAnswers -> reveal/score ->
  disputeWindow -> disputeVote -> leaderboard -> advance` and `endGame`.
- **Difficulty blend** - the setting picks weights for each question draw (percent easy / medium
  / hard), interpolated as this table:

  | Setting | easy | medium | hard |
  |---|---|---|---|
  | 1 | 80 | 18 | 2 |
  | 2 | 70 | 25 | 5 |
  | 3 | 60 | 30 | 10 |
  | 4 | 50 | 35 | 15 |
  | 5 (default) | 40 | 40 | 20 |
  | 6 | 30 | 42 | 28 |
  | 7 | 22 | 40 | 38 |
  | 8 | 15 | 37 | 48 |
  | 9 | 8 | 32 | 60 |
  | 10 | 3 | 22 | 75 |

  Each round samples a difficulty tier by these weights, then picks an unused question of that
  tier in the chosen category; if that tier is exhausted, fall back to the nearest tier.
- **Answer matching tolerance** - exact match after normalization is the baseline. To cut false
  negatives from typos, also accept a Levenshtein distance of 1 for answers of 5+ characters.
  Decision to confirm in review: keep the fuzzy tolerance, or require exact-normalized only and
  lean entirely on the dispute mechanic. The dispute vote is the human fallback either way.
- **State** lives in the engine (Redis-backed session from `0007`) for the life of the game:
  scores, used questions, current round, dispute/vote tallies. Player devices push answers and
  votes and stream leaderboard/prompt updates.
- **Scoring events** (correct = 100, upheld dispute = 50) and final standings are emitted through
  the `0007` contract so the control-plane bills the round and awards stars; this spec does not
  talk to Postgres directly.

## Acceptance

- [ ] Host can configure category (8 + Random), rounds (1-100, default 10, out-of-range
      rejected), and difficulty (1-10, default 5); the draw matches the blend table within
      tolerance over a game.
- [ ] Each round serves one non-repeating question; correct normalized answers score 100.
- [ ] Dispute window is 10s; a disputed answer upheld by a majority of the other players awards
      the disputer 50; no majority awards nothing.
- [ ] A leaderboard shows between rounds and the host advances manually.
- [ ] At game end the highest score wins; standings are reported for stars (3/2/1).
- [ ] `Random` draws across all categories; a game never repeats a question.
- [ ] Unit tests cover answer normalization/matching, the difficulty draw distribution, dispute
      resolution (majority, tie, no dispute), and end-of-game ranking including score ties.
