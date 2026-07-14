# 0009 - Trivia question bank

## Problem

Trivia (`0008`) needs a corpus of questions with acceptable answers and difficulty ratings.
It must be large enough for varied play without repeats, spread across the difficulty scale, and
loadable by the engine.

## Outcome

- A bank across the 8 categories (`Nature, Food, Animals, Science, People, Places, Things,
  History`), each question with acceptable answers and an integer 1-10 difficulty rating. (Seeded
  at 1600 questions - 200 per category; the fixed count/spread gate was later dropped by `0041`, so
  the bank grows freely.)
- Difficulty spread across the 1-10 scale within each category so a min-max range (`0008`) has
  questions to draw.
- A validated, versioned data set the engine loads and `0008` draws from.

## Scope

In:
- The question **schema** and the data files, one per category:
  `apps/game-engine/data/trivia/<category>.json` (lowercase category), each a JSON array of 200.
- A **loader + validator** in the engine that reads the files (or seeds Postgres) and fails fast
  on any violation.
- A short **spot-check** step in the spec's acceptance so a human samples factual accuracy before
  it ships.

Out:
- The matching/draw logic (`0008`), the room/UI, and any authoring tool. Localization.

## Approach

- **Schema** - each question:

  ```json
  {
    "id": "nature-001",
    "category": "Nature",
    "prompt": "What gas do plants absorb from the air for photosynthesis?",
    "answers": ["carbon dioxide", "co2"],
    "difficulty": 3
  }
  ```

  - `id` unique, `<category>-NNN` zero-padded. `category` one of the 8. `prompt` one sentence,
    never contains the answer. `answers` a non-empty array of acceptable strings (variants:
    synonyms, spellings, with/without article). `difficulty` is an integer 1-10 obscurity rating
    (1-2 near-universal, 5-6 moderate, 9-10 obscure); the min-max difficulty range in `0008` draws
    against it. (Difficulty moved from an `easy|medium|hard` tier to this 1-10 scale when the range
    model folded into `0008`; answer casing and the completeness/spread gates are governed by
    `0042` (Title Case) and `0041` (external data) respectively.)
- **Data** - generated per category (bulk drafting was fanned out to a subagent per category).
  Because generated trivia can contain factual slips, treat the corpus as a draft: the validator
  enforces structure and distribution, and a human spot-check pass (sample per category) catches
  facts before merge. The in-play dispute vote (`0008`) covers residual errors.
- **Validation** (a test, must pass before merge): ids unique and correctly prefixed; every
  `answers` non-empty; `difficulty` an integer 1-10; no duplicate prompts within a category.
  (This spec seeded a per-category even-split gate; `0041` later removed the count/spread gates,
  keeping only these per-item structural checks.)
- **Loading** - the engine loads the JSON at startup (and/or seeds a Postgres `questions` table
  via the `0001` docker-compose Postgres). Keep the JSON the source of truth; the DB is a cache
  for query/serve.

## Acceptance

- [ ] 8 category files, all schema-valid, difficulty spread across the 1-10 scale per category.
- [ ] Ids unique and prefixed; answers non-empty; `difficulty` an integer 1-10; prompts do not
      leak answers.
- [ ] The validator test passes and runs in CI; a documented spot-check sampling was done and
      noted in the PR.
- [ ] The engine loads the bank and `0008` can draw from it without repeats in a game.
