# 0009 - Trivia question bank

## Problem

Trivia (`0008`) needs a corpus of questions with acceptable answers and difficulty ratings.
It must be large enough for varied play without repeats, evenly spread across difficulty, and
loadable by the engine.

## Outcome

- 1600 questions: 200 for each of the 8 categories (`Nature, Food, Animals, Science, People,
  Places, Things, History`), each with acceptable answers and a difficulty rating.
- Roughly even easy/medium/hard within each category.
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
    "difficulty": "easy"
  }
  ```

  - `id` unique, `<category>-NNN` zero-padded. `category` one of the 8. `prompt` one sentence,
    never contains the answer. `answers` a non-empty array of lowercase acceptable strings
    (variants: synonyms, spellings, with/without article). `difficulty` is `easy | medium | hard`.
- **Data** - generated per category (bulk drafting was fanned out to a subagent per category).
  Because generated trivia can contain factual slips, treat the corpus as a draft: the validator
  enforces structure and distribution, and a human spot-check pass (sample per category) catches
  facts before merge. The in-play dispute vote (`0008`) covers residual errors.
- **Validation** (a test, must pass before merge): 200 per category and 1600 total; ids unique
  and correctly prefixed; every `answers` non-empty and all-lowercase; `difficulty` in the enum;
  each category within tolerance of an even split (each tier 60-74 of 200); no duplicate prompts
  within a category.
- **Loading** - the engine loads the JSON at startup (and/or seeds a Postgres `questions` table
  via the `0001` docker-compose Postgres). Keep the JSON the source of truth; the DB is a cache
  for query/serve.

## Acceptance

- [ ] 8 files, 200 questions each, 1600 total, all schema-valid.
- [ ] Each category is within the even-distribution tolerance across easy/medium/hard.
- [ ] Ids unique and prefixed; answers non-empty and lowercase; prompts do not leak answers.
- [ ] The validator test passes and runs in CI; a documented spot-check sampling was done and
      noted in the PR.
- [ ] The engine loads the bank and `0008` can draw from it without repeats in a game.
