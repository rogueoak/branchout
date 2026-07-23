# 0074 - Trivial Matters: multi-type questions + duration presets

## Problem

Trivia (specs 0008, 0016, 0017, 0068) is a single-note game: every round is one open-answer,
free-text recall question scored by fuzzy match, with a dispute vote for close calls. It plays fine
but flat - the operator finds it less fun than hoped. Every round feels identical, typing a full
answer on a phone is slow, and the only pacing lever is "how many rounds". The operator wants to
rename it to **Trivial Matters** and rearchitect it into a varied game that mixes three question
shapes - multiple choice (A/B/C/D), true/false, and open answer - paced by a duration preset
(Fast/Standard/Long/Marathon/Custom) instead of a bare round count, with two new categories (Movies,
Music).

## Outcome

- The game is presented everywhere as **Trivial Matters** (game picker, `/games` index, its feature
  page, hero/share copy, in-game surfaces). The internal id, route slug, data folder, and brand asset
  keys stay `trivia` - the rename is display-only, so no data path, saved game, or URL breaks.
- A round is one of three types, drawn by a plan the host's duration sets:
  - **Multiple choice** - the question with four options (the canonical answer + three distractors),
    tapped, objectively scored. Worth **100**.
  - **True / false** - a statement the player judges true or false. Worth **75**.
  - **Open answer** - today's free-text recall question, fuzzy-matched, **dispute-eligible**. Worth
    **150**. The hardest, so it scores highest and keeps the dispute vote.
  Disputes run **only on open rounds** (MC/TF are unambiguous, so their reveal offers no dispute).
- The host picks a **Duration** in Game setup: Fast, Standard, Long, Marathon, or Custom. Each preset
  fixes the mix and order of question types (see Approach). Custom reveals three numeric inputs
  (multiple-choice / true-false / open counts). Duration replaces the raw "Rounds" number; the
  category multiselect and difficulty-range presets stay as independent controls.
- Each question type has its own answer timer (a tap needs less time than typing): defaults
  **20s** MC, **15s** TF, **60s** open, all host-adjustable in Advanced settings.
- Two new categories, **Movies** and **Music**, join the existing eight; all ten categories carry all
  three question types, so any single category can solo-run any duration up to Marathon.
- The private `branchout-data` bank is augmented (distractor `choices` on recall questions, new
  true/false items, new Movies/Music banks), validated, tagged as a new data release, and pinned via
  `deploy/data.version`.

## Scope

In:

- **Engine (`packages/games/trivia`)**: a `type` discriminator + `choices`/`isTrue` on the question
  model and loader/validator; a duration -> ordered round-plan builder (composition + open placement)
  computed in `configure` and stored in scratch; draw-by-type with the existing no-repeat guarantee
  and an up-front per-type pool-sufficiency check; per-type scoring (100/75/150); open-only disputes;
  per-type move windows; MC option shuffling; `Movies`/`Music` in `CATEGORIES`. Config gains
  `duration` (+ custom `multipleChoice`/`trueFalse`/`open` counts) and per-type timer fields,
  superseding `rounds` (kept as a tolerated legacy alias mapping to a Custom open-only plan).
- **Engine SDK + engine (`packages/game-sdk`, `apps/game-engine`)**: add optional `moveWindowMs` to
  `StartRoundResult`; `startRoundInto` applies it per round (falling back to the configure-time
  window). Additive and backward compatible - a game that never sets it is unchanged.
- **Web (`apps/web/lib/games/trivia`)**: a `Duration` `OptionSelector` (presets + Custom-reveals-
  numeric-inputs, modeled on today's Rounds control) in `ConfigPanel`; per-type timer inputs in
  `AdvancedConfigPanel`; the config mirror + `validateTriviaConfig` kept in lockstep with the engine;
  `roundsOf` derived from the plan; `protocol.ts` prompt/reveal carry `type` + `choices`;
  `QuestionCard`/`Remote`/`Viewer`/`AnswerReveal` render all three modes (MC option buttons, TF
  True/False, open text) and hide the dispute affordance off open rounds; `Movies`/`Music` in the
  category list.
- **Rename surfaces**: display name "Trivial Matters" in the engine manifest, web UI module
  (`name`/`tagline`/`summary`), marketing `catalog.ts`, `library.ts`, and the brand wordmark/hero copy
  (`packages/brand/src/trivia.ts`, `hero-trivia.ts`, `hero-portrait-trivia.ts`). Data `config.json`
  `displayName`.
- **Data (`branchout-data`)**: augment the eight banks with `choices` (>=3 distractors) on enough
  recall items and add true/false items per category; author `movies.json` + `music.json` (open +
  MC-capable + true/false); add `Movies`/`Music` to `trivia/config.json` `categories`; extend
  `config.json` `fields` (new `type` enum, `choices` string[], `isTrue` boolean; make `answers`
  required only for recall) and update the "eight categories" prose; extend `scripts/validate.mjs` and
  the studio `validate.ts` to branch required fields by `type`. Cut a new semver tag and bump
  `deploy/data.version`.
- **Tests**: engine unit tests for the plan builder (composition + placement per preset + custom),
  draw-by-type, per-type scoring, open-only disputes, per-type windows, pool-sufficiency rejection;
  web tests for the duration selector, custom inputs, per-type timer fields, and the three render
  modes; update the `trivia-round` e2e and add an e2e that plays a Fast game covering one of each type
  through to the leaderboard.

Out:

- Changing the route slug, engine id, data-folder name, or brand asset keys (all stay `trivia`).
- Per-game share/OG raster changes beyond the wordmark copy (the existing `/share-trivia.png` reuse
  stands; a refreshed raster is a follow-up).
- Speed/streak bonuses, per-question point overrides in data, or difficulty-weighted scoring.
- Any change to other games or to the studio's generate/promote UI beyond the validator branch.

## Approach

**Question model (augment, not replace).** A recall item keeps `answers[]` and gains an optional
`choices[]` (three distractors); with choices it is MC-eligible, without it is open-only. True/false
is genuinely different content, so it is a distinct item discriminated by a `type` field
(`"true-false"`), carrying the statement in `prompt` and a boolean `isTrue`. Recall items default to
`type: "recall"` when the field is absent, so the 1,600 existing questions need no rewrite. One file
per category still holds everything (the studio's one-file-per-category model is untouched); the
loader flattens as today and the game engine branches on `type`. MC options are `[answer, ...choices]`
shuffled by the injected rng at draw time (deterministic in tests).

**Duration -> plan.** `configure` turns the duration into an ordered list of round types, stored in
scratch, and `startRound` draws the type for `ctx.round`. Compositions:

| Duration | MC | TF | Open | Total |
| --- | --- | --- | --- | --- |
| Fast | 3 | 2 | 1 | 6 |
| Standard | 6 | 4 | 2 | 12 |
| Long | 12 | 8 | 4 | 24 |
| Marathon | 24 | 16 | 8 | 48 |
| Custom | host | host | host | sum |

Open placement: the K open rounds land at evenly spaced positions with the **last question always
open** - position `ceil(i * N / K)` for `i` in `1..K` (Fast K=1 -> only #6; Standard -> #6,#12; Long
-> #6,#12,#18,#24; Marathon -> every sixth ending #48). The remaining slots are filled by a shuffle of
the MC and TF rounds. Custom uses the same rule (and if it has zero opens, the tail rule simply does
not apply). This lives in one pure, unit-tested `buildRoundPlan(composition, rng)`.

**Draw + sufficiency.** The draw filters the pool by the host's categories and difficulty range (as
today) and by the round's type: open -> any recall item; MC -> a recall item with `choices`; TF -> a
true-false item. The whole-game no-repeat set (`usedIds`) is unchanged. `configure` rejects up front
if the chosen pool cannot supply the plan (enough recall for open+MC, enough choice-bearing recall for
MC, enough true-false for TF), mirroring today's "fewer questions than rounds" guard so a game never
dies mid-play.

**Scoring + disputes.** Points become per-type constants (MC 100, TF 75, open 150). Only open rounds
populate the dispute-eligible `wrong` set and stream the dispute affordance; MC/TF rounds still show a
reveal and the auto-advance dwell but have no disputers, so the `disputing -> voting` phases collapse
to nothing (the engine already skips voting on an empty dispute set). Correctness for MC/TF is exact
(chosen option === canonical answer / chosen boolean === `isTrue`), bypassing the fuzzy matcher; open
answers keep `isCorrectAnswer`.

**Per-type timers.** The engine's move window is set once at `configure` today. We add an optional
`moveWindowMs` to `StartRoundResult`; `startRoundInto` sets `state.moveWindowMs` from it (falling back
to the configure value) before arming the timer, so pause/resume and the client state frame report the
current round's window with no further change. The Trivia module returns the type's window each round.

**Config lockstep.** As with 0068, the web `TriviaHostConfig` mirror and `validateTriviaConfig` stay
in step with the engine authority; the engine re-validates on the start handoff. `duration` is the new
primary control; `rounds` remains accepted as a legacy alias (an N-round open-only Custom plan) so an
in-flight or bookmarked config never hard-fails.

**Data + release.** I author the content directly via parallel agents with a fact-check pass, sized so
every single category can solo-run Marathon: keep the ~200 open recall per existing category, add
`choices` to at least ~30 of them and at least ~30 true/false items each; give Movies and Music a full
new open set (~150) plus the same MC/TF coverage. The extended `validate.mjs` enforces the per-type
shape; the CI validator gate stays green. Then tag `branchout-data` (next semver after `0.4.0`) and
bump `deploy/data.version` in a normal PR, which triggers the deploy that mounts the pinned bank.

## Acceptance

- [ ] The game reads "Trivial Matters" on the game picker, `/games`, its feature page, hero/share
      copy, and in-game surfaces; the id/slug/data-folder/brand-keys remain `trivia` and every existing
      route and saved game still resolves.
- [ ] `buildRoundPlan` yields the exact composition and open placement above for Fast/Standard/Long/
      Marathon and for a Custom mix, always ending on an open when opens > 0 (unit-tested).
- [ ] A drawn MC round streams four shuffled options including the canonical answer; TF streams a
      statement judged against `isTrue`; open is unchanged. Correct MC/TF score 100/75, correct open
      scores 150, and only open rounds offer disputes (upheld dispute still +50).
- [ ] Each type uses its own answer window (20/15/60s defaults, host-adjustable); the client countdown
      reflects the current round's window; pause/resume preserves it.
- [ ] `configure` rejects a duration+category+difficulty combination the pool cannot supply, before
      the game starts, with a descriptive error.
- [ ] Game setup shows a Duration selector (Fast/Standard/Long/Marathon/Custom) with Custom revealing
      three count inputs; category multiselect (ten categories + Random) and difficulty presets remain;
      Advanced shows the three per-type timers.
- [ ] `Movies` and `Music` banks exist with all three question types; every category can solo-run
      Marathon; `validate.mjs` (extended for `type`/`choices`/`isTrue`) passes on the whole `trivia`
      game and CI is green.
- [ ] `branchout-data` is tagged at the new version and `deploy/data.version` is bumped to it.
- [ ] Engine + web unit tests, the updated `trivia-round` e2e, and a new one-of-each-type Fast e2e
      pass; lint, typecheck, `@branchout/web` build, and `prettier --check` all pass.
