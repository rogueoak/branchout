# 0041 - Trivial Matters draw order can starve MC despite a passing pool guard

## Symptom

In the first cut of the three-type draw (spec 0074), `configure` proved a valid per-type assignment
_existed_ for the chosen categories + difficulty (`mcCapable >= mc`, `recall >= mc + open`) and then
threw the game away up front if it did not - the "a game never dies mid-play" guarantee. But the
runtime per-round draw did not honor that proof: an open round accepted _any_ recall item
(`acceptFor('open') = isRecallQuestion`), including the choice-bearing, MC-capable recall that MC
rounds require, and all round types share one `usedIds` set. Because `buildRoundPlan` interleaves
opens among MC rounds (Standard puts an open at position 6, before MC rounds at 7-11), an open could
grab the last MC-capable item and strand a later MC round, so `startRound` threw "ran out of
multiple-choice questions" after players had already invested rounds. Three personas
(engineer/architect/tester) flagged it on PR #174; a concrete tight pool (6 MC-capable + 2 open-only +
4 TF at Standard) passes all three `configure` checks yet dies for some rng seeds.

## Root cause

The existence proof and the greedy consumer disagreed. `configure` counted aggregate pools; the draw
consumed greedily in plan order with no bias, so an early, unbiased open could consume supply the
guard had implicitly reserved for MC. An invariant proven over _counts_ is not automatically preserved
by a _greedy, ordered_ allocator that can spend a shared resource on the wrong bucket.

## Fix

Give the open draw a preference chain: open-only recall first (`isRecallQuestion(q) &&
!isMultipleChoiceCapable(q)`), falling back to any recall only when the open-only pool is exhausted
(`acceptChainFor` in `trivia.ts`). This provably preserves the guard: opens borrow an MC-capable item
only after open-only is gone, so at most `max(0, open - openOnly)` are borrowed, leaving
`min(mcCapable, recall - open) >= mc` for MC whenever `configure` passed. Covered by a tight-pool test
run over several seeds that plays a full 12-round game without a throw.

## Lesson

When a guard proves an allocation _exists_ over aggregate counts, the runtime allocator must actually
_find_ it - a greedy consumer over a shared pool needs a preference/priority that matches the proof,
or the guard is theater. Prefer the most-constrained consumer (here: MC needs choice-bearing recall)
by reserving its supply and letting the flexible consumer (open: any recall) take leftovers. Test the
tight boundary where the guard is exactly satisfied, not just the roomy happy path.
