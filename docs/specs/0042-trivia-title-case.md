# 0042 - Trivia answers stored in Title Case (drop on-the-fly display casing)

## Problem

The Trivia bank stored answers all-lowercase, and the web viewer reconstructed Title Case at render
time with `toDisplayAnswer()` - a best-effort caser over a hand-maintained acronym allowlist. Two
problems: (1) it manipulates the answer on the fly instead of showing what the data says, and (2) the
reconstruction is lossy - an acronym or proper noun not on the allowlist renders wrong (`Dna`,
`Mcqueen`), and the allowlist is a standing maintenance burden. The developer wants the answer to be
**correct in the data**: stored in Title Case (with acronyms in their conventional form) and shown
verbatim, exactly as Liar Liar already does.

The paired data change lives in the private `branchout-data` repo (its spec 0004); this spec is the
branchout side - the engine's validation, the viewer's display, the dev sample, and the tests.

## Outcome

- The Trivia question-bank validator no longer requires answers to be all-lowercase; it still
  requires each answer to be a non-empty string. Title-cased banks (the mounted production data and
  the refreshed sample) load cleanly.
- The web viewer shows the stored answer **verbatim** - canonical answer, "also accepted" alternates,
  and each player's own submission - with no casing transform. `toDisplayAnswer()` and its allowlist
  are deleted.
- Matching is unchanged: `matching.ts` already lowercases both the submission and each accepted
  answer, so case-insensitive scoring is unaffected by the stored casing.
- The public dev sample is refreshed to Title Case so local runs / e2e look like production.

## Approach

- **Validator (`packages/games/trivia/src/question-bank.ts`).** Remove the
  `answer !== answer.toLowerCase()` throw and its rule text; keep the non-empty check. Update the
  `TriviaQuestion.answers` doc to "stored in display Title Case; `answers[0]` is canonical; matched
  case-insensitively".
- **Viewer (`apps/web/lib/games/trivia/Viewer.tsx`).** Drop the `toDisplayAnswer` import and render
  `reveal.answers[0]`, `reveal.answers.slice(1).join(', ')`, and `s.answer` directly. Delete
  `apps/web/lib/title-case.ts` + its test.
- **Sample data.** Refresh `packages/games/trivia/data/trivia/*.json` to the Title-Case first-N
  items (same ids as production).
- **Tests.** Replace the "throws when not lowercase" case with "accepts Title-Case answers" + a blank
  answer case; update the Viewer tests to assert verbatim display of Title-Case fixtures.

## Out of scope

- Liar Liar (already Title Case).
- Any change to matching/normalization (`matching.ts` is correct as-is).
