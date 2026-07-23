# 0074 - Trivial Matters build plan + shared contract

Source spec: `docs/specs/0074-trivial-matters-question-types.md`. This is the SINGLE SOURCE OF TRUTH
for the cross-package contract so the engine, web, and data streams build in lockstep. Do not deviate
from the shapes below without updating this file.

## Locked data model (question bank)

One JSON file per category (unchanged layout). Two item shapes, discriminated by `type`:

Recall item (open + MC-capable). `type` omitted or `"recall"`. Existing 1,600 items are recall; we
add optional `choices`:
```json
{ "id": "animals-002", "category": "Animals", "prompt": "What is the fastest land animal?",
  "answers": ["Cheetah"], "choices": ["Lion", "Pronghorn", "Greyhound"],
  "difficulty": 2, "verified": true }
```
- `answers[0]` is canonical. `choices` (>= 3 distractors) makes the item MC-eligible; without it the
  item is open-only. MC options = `[answers[0], ...choices.slice(0,3)]` shuffled by the engine rng.

True/false item. `type: "true-false"`, statement in `prompt`, boolean `isTrue`, no `answers`:
```json
{ "id": "animals-231", "type": "true-false", "category": "Animals",
  "prompt": "A shrimp's heart is located in its head.", "isTrue": true,
  "difficulty": 3, "verified": true }
```
- TF items share the category file's numeric id sequence (continue after the recall items). The
  `type` field, not the id, marks the type - the id pattern `^[a-z]+-\d{3}$` is unchanged.

## Locked round-type + wire contract

Runtime round types: `'multiple-choice' | 'true-false' | 'open'`.

`TriviaPrompt` (startRound `prompt`):
```ts
{ round: number; type: 'multiple-choice' | 'true-false' | 'open';
  category: string; difficulty: number; question: string; choices?: string[] }
```
- `choices` present only for `multiple-choice` (4 shuffled options incl. the canonical answer).
- `question` holds the prompt text; for `true-false` it is the statement.

`collectMove` answer string: open -> free text (unchanged); multiple-choice -> the chosen option
text (must equal one of `choices`); true-false -> `"True"` or `"False"`.

`TriviaRoundReveal` gains `type: 'multiple-choice' | 'true-false' | 'open'`. Everything else stays:
`answers` = `[canonical]` for MC, `["True"]`/`["False"]` for TF. `wrong` (dispute-eligible) is
populated ONLY for open rounds.

## Locked config contract (engine authority + web mirror in lockstep)

```ts
type Duration = 'fast' | 'standard' | 'long' | 'marathon' | 'custom';

interface TriviaConfig {          // host-supplied, all optional
  categories?: string[];          // subset of the 10; empty = Random (all)
  duration?: Duration;            // default 'standard'
  custom?: { multipleChoice: number; trueFalse: number; open: number }; // required iff duration==='custom'
  difficultyMin?: number;         // 1-10, default 3
  difficultyMax?: number;         // 1-10, default 6
  autoAdvance?: boolean;          // default true
  advanceAfterSeconds?: number;   // 1-60, default 5
  mcTimeLimitSeconds?: number;    // 5-180, default 20
  tfTimeLimitSeconds?: number;    // 5-180, default 15
  openTimeLimitSeconds?: number;  // 10-180, default 60
  // Legacy (tolerated): `rounds` -> Custom open-only plan of N; `timeLimitSeconds` -> openTimeLimitSeconds.
  rounds?: number;
  timeLimitSeconds?: number;
}
```

Duration compositions (MC / TF / open):
```
fast     3 / 2 / 1   (6)
standard 6 / 4 / 2   (12)
long     12 / 8 / 4  (24)
marathon 24 / 16 / 8 (48)
custom   host counts (>=1 total; each 0-30; total <= 60)
```

`buildRoundPlan(composition, rng): RoundType[]` - N = mc+tf+open, K = open. Place `'open'` at
positions `ceil(i * N / K)` (1-indexed) for i in 1..K, so the LAST question is always open. Fill the
remaining positions with a shuffle of the mc `'multiple-choice'` and tf `'true-false'` rounds. K=0 ->
no opens, all remaining shuffled. Pure + unit-tested.

## Locked scoring + timers

- Points: MC = 100, TF = 75, open = 150. Dispute upheld = +50 (open only).
- Disputes: only open rounds populate `wrong` and stream the dispute affordance; MC/TF collapse the
  dispute/vote phases (empty dispute set) but keep the auto-advance dwell.
- Per-round move window: MC -> `mcTimeLimitSeconds`, TF -> `tfTimeLimitSeconds`, open ->
  `openTimeLimitSeconds`. Delivered via the new `StartRoundResult.moveWindowMs` (see engine change).

## Categories (now 10)

`Nature, Food, Animals, Science, People, Places, Things, History, Movies, Music`. Add `Movies` +
`Music` to the engine `CATEGORIES`, the web `CATEGORIES`, and `branchout-data/data/trivia/config.json`.

## Engine SDK change (foundational)

Add optional `moveWindowMs?: number` to `StartRoundResult` (`packages/game-sdk/src/lifecycle.ts`).
In `apps/game-engine/src/engine.ts` `startRoundInto`: `if (result.moveWindowMs !== undefined)
state.moveWindowMs = result.moveWindowMs;` BEFORE computing `state.moveDeadline` and arming the
window. Additive + backward compatible; pause/resume and the client state frame then report the
current round's window with no further change. Add a worker passthrough test if the worker serializes
the result (it returns the object as-is, so no change needed there).

## Work streams

1. Engine (`packages/game-sdk`, `apps/game-engine`, `packages/games/trivia`, bundled sample data,
   engine unit tests).
2. Web (`apps/web/lib/games/trivia`, rename surfaces in `catalog.ts`/`library.ts`/`registry` copy,
   brand `packages/brand/src/trivia.ts` + hero copy, web unit tests).
3. Data (`branchout-data` on branch `trivial-matters-data`: config.json + validators, augment banks,
   Movies/Music, tag + pin).

## Rename (display-only)

Display name "Trivial Matters" in: engine manifest `name`, web module `name`/`tagline`/`summary`,
`catalog.ts`, `library.ts`, brand wordmark/hero copy, data `config.json` `displayName`. Keep id, slug,
data folder, and brand asset keys as `trivia`.
