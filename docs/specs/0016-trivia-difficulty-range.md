# 0016 - Trivia difficulty as a 1-10 range

## Problem

Trivia difficulty was one setting 1-10 that fixed a *blend* of easy/medium/hard tiers (spec 0008):
even at a chosen setting, a game drew across all three tiers, so difficulty felt "all over the
place" - a host could not ask for a consistent band. With only three tiers, a single number could
never express "keep it around the middle".

## Outcome

The host sets a **min-max difficulty range** (default 4-6) and the game draws only questions whose
rating falls in it, widening to the nearest rating only when the range runs dry. Every question
carries an integer 1-10 rating (the bank was re-rated on a real scale), so the range is meaningful
end to end: a 4-6 game plays consistent middle questions; 1-3 plays easy; 8-10 plays hard.

## Scope

In:
- **Data**: re-rate all 1600 questions from the `easy|medium|hard` tier to an integer 1-10
  `difficulty` (obscurity for a general adult audience). The bank stays the source of truth.
- **Schema/validator** (`question-bank.ts`): `difficulty` is an integer 1-10; each category must
  spread across the scale (>= 6 distinct ratings, span >= 6) rather than the old per-tier counts.
- **Selection** (`difficulty.ts`, `selection.ts`): drop the blend table and tier sampling; index by
  category and pick an unused question rated in `[min, max]`, widening to the nearest rating when
  the range is exhausted; never repeat within a game.
- **Config** (engine `trivia.ts`, web `trivia-config.ts`): replace `difficulty` with
  `difficultyMin` / `difficultyMax` (integers 1-10, min <= max, default 4-6). Validate on both
  sides; the engine is the authority.
- **Wire**: the prompt's `difficulty` becomes the drawn question's numeric rating; the web decoder
  and the difficulty badge follow ("Difficulty 7/10").
- **UI**: a mobile-first `DifficultyRange` (two native range thumbs, clamped so min <= max, with a
  live readout) replaces the single numeric input in the host config panel.

Out:
- Re-authoring question *content* or answers (only the rating changes). Per-question difficulty
  editing tools. Any change to rounds, categories, scoring, or the dispute flow.

## Approach

- **Re-rate** by fanning a subagent per category over the 1-10 rubric (1-2 near-universal, 5-6
  moderate, 9-10 obscure), merged into the JSON by id so only the `difficulty` field changes; a
  human spot-check per category (sampled low/mid/high) confirmed calibration before merge.
- **Widening** prefers in-range questions (distance 0), then the nearest rating by absolute
  distance, tie-breaking toward the easier side - a gentler surprise than jumping to an extreme.
  `configure` still guards the whole-category pool >= rounds, so a game never truly runs dry.
- **Native dual slider** over a custom dual-thumb control or Radix: accessible and testable without
  portals, on-theme via `accent-primary` (matches the repo's prefer-native rule, spec 0010).
- **Deploy lockstep** (architect review): the `prompt` payload is opaque/unversioned, so the
  `difficulty` string->number flip is a hard cutover - ship engine + web together, or an old web
  bundle would drop a numeric prompt and strand the viewer. Trivia is not yet in production, so a
  hard cutover is acceptable now. Defensively, `asScratch` maps a legacy single `difficulty` key to
  a single-rating band so a game already in flight across the engine deploy degrades gracefully
  instead of silently resetting to 4-6.

## Acceptance

- [x] All 1600 questions carry an integer 1-10 `difficulty`; the validator enforces range + spread
      and passes on the real bank in CI.
- [x] The draw returns only in-range questions until the range is exhausted, then the nearest
      rating, never repeating; proven by unit tests (in-range, widening, Random, exhaustion).
- [x] Host config takes a min-max range (default 4-6), validated on both sides (bounds + min<=max);
      the slider clamps so the thumbs cannot cross.
- [x] The prompt carries the numeric rating; the web decoder accepts a number and the badge shows
      "Difficulty N/10".
- [x] A documented spot-check sampled ratings per category (noted in the PR).
