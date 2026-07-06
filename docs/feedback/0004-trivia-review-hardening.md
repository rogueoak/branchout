# 0004 - Trivia review hardening (spec 0008)

## Symptom

Spectra persona review of the `0008` Trivia PR surfaced fixable gaps in the first cut, one major
(a test-coverage hole) plus minors across correctness, data model, and cleanup:

- **Dispute-majority denominator not falsifiable (tester, major).** Every dispute test used a
  3-player roster, so `others = 2`. At that size several wrong majority denominators
  ("ballots cast", or "all players including the disputer") produce the *same* verdict as the
  correct "other players", so a subtly-wrong implementation would have passed green. The dense
  scoring rule the spec explicitly flags was effectively unproven.
- **Dispute denominator counted disconnected players (engineer, minor).** `disputeVote` divided
  by the whole roster minus the disputer, including offline devices. In a party game where
  devices drop, counting an absent player as an implicit "no" can make a legitimate dispute
  mathematically impossible to win.
- **Unbounded per-round scratch (architect, minor).** The module kept every round's working
  state (questions, submissions, ballots) in `scratch` for the life of the game, yet only ever
  read the current round. Because the engine persists and the module deep-clones the whole
  scratch every frame, the Redis blob and per-frame clone cost grew with each round played.
- **Smaller:** punctuation normalization split numeric separators (`1,000` -> `1 000`, no
  match); a write-only `correct` scratch field; an unused `QuestionIndex.categories`; dead
  defensive code in the question pick; and missing tests for the 10s window (a tautological
  assert), the between-round leaderboard, multi-disputer rounds, and blank/absent submissions.

## Root cause

The first implementation proved the happy path on the smallest roster that "looked" complete
(3 players), which happens to be exactly the size where the dispute math degenerates. The scratch
model mirrored the stub's per-round map without pruning, since the stub only ever runs a few
rounds in tests so growth never bit. The disconnected-voter and numeric-separator cases are real
partitions that the synthetic happy-path fixtures never exercised.

## Fix

- Restrict the dispute denominator to *connected* other players
  (`p.player !== disputer && p.connected`) and document why absent players are excluded.
- Prune finalized rounds in `startRound`: keep `usedIds` and reset the per-round maps to the
  current round only, bounding the persisted blob and clone cost to one round.
- Normalize numeric separators (punctuation between two digits) by removal, not spacing, so
  `1,000` matches `1000`; drop the write-only `correct` field and the unused `categories` field;
  simplify the in-bounds pick.
- Add tests on 4-5 player rosters that falsify the wrong denominators (2-of-3 upholds; 1-of-3
  with two silent does not; a disconnected player cannot block; multiple disputers resolve
  independently), plus the 10s window literal, the leaderboard, blank/absent submissions, and a
  strictly-descending end-game ranking.

## Learning

Two lessons generalize past this feature:

- **Test a majority/quorum rule at a roster size where the wrong denominators diverge.** A vote
  over N others where the threshold is `agrees*2 > N` is indistinguishable for
  "others" vs "ballots cast" vs "all players" at N=2; pick a size (odd, >= 3 others) where each
  candidate denominator yields a different verdict, or the test proves nothing.
- **Prune an ephemeral session's per-round scratch to the round in play.** State the engine
  persists and clones every frame must not accumulate rounds it never reads again, or the blob
  and per-frame cost grow with game length.
