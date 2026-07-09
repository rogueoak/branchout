# 0022 - Liar Liar seed clue bank

## Problem

Liar Liar's engine logic shipped in `0021` against synthetic clues; it cannot actually be played until
it has real content. Like Trivia (`0008` logic, `0009` bank), the content is its own spec so it can be
curated and reviewed independently. Liar Liar's content is the delicate part: each clue is an
improbable-but-TRUE fact whose answer must actually be correct, so the seed is small and every entry is
research-sourced and human-reviewed before it ships.

## Outcome

A validated seed clue bank of ~119 clues across all eight categories (`people, places, events, sports,
food, nature, animals, things`), each carrying a `source` URL for its fact, plus a strict
`validateSeedBank` gate and the wiring that registers Liar Liar in the engine boot - so a host can now
start and play a real game of Liar Liar.

## Scope

In:
- **`packages/games/liar-liar/data/liar-liar/<category>.json`** - the eight category files, 13-16 clues
  each (`MIN_CLUES_PER_CATEGORY = 12`), each `{ id, category, clue, answer, aliases?, source }`. Facts
  were researched and verified against a reputable source (mostly Wikipedia); the `source` field
  carries that URL for review. ASCII-only per Trellis.
- **`clues.ts`**: `source?` added to `LiarLiarClue` (validated as a non-empty string when present); a
  new `validateSeedBank` (all of `validateClueBank` plus category coverage >= `MIN_CLUES_PER_CATEGORY`,
  the `<category>-NNN` id convention, and no duplicate prompt within a category). `validateClueBank`
  stays lenient so synthetic unit-test banks still validate.
- **`liar-liar.ts`**: the plugin `create` now `validateClueBank`s the loaded bank so malformed shipped
  data aborts boot with a clear error.
- **Real-data test** (`clue-bank.test.ts`): loads the real files through the package-rooted fs asset
  loader and runs `validateSeedBank` - the path-resolution + content-integrity guard.
- **Engine boot**: depends on `@branchout/game-liar-liar`, registers `liarLiarPlugin` alongside Trivia,
  and keeps it `external` in tsup (data read from disk, not bundled).

Out:
- The web client for Liar Liar and control-plane game selection (`0023`); LAN dev (`0024`). Expanding
  the bank beyond the seed (a later content pass). No factual guarantee is enforceable by code - the
  seed is small precisely so a human can review every fact; the `source` per clue supports that.

## Approach

- **Research-grounded, human-reviewed.** Clues were drafted by web-research agents that verified each
  fact against a source and cited it; the set was then reviewed (a debunked "honey never spoils / tomb"
  entry and an HTML-escaped `M&M's` were caught and fixed). CI/persona review cannot check truth, so the
  `source` URLs are the reviewer's tool and the seed is intentionally small.
- **Two validators, two jobs.** `validateClueBank` is the boot-time schema/integrity check (lenient on
  coverage so partial/synthetic banks pass); `validateSeedBank` is the strict real-bank gate exercised
  by the real-data test.

## Acceptance

- [ ] Every category file loads through the package-rooted fs loader and `validateSeedBank` passes
      (>= 12 clues/category, `<category>-NNN` ids, unique prompts, valid `source`s).
- [ ] The engine boots with both `trivia` and `liar-liar` registered; a malformed clue file aborts boot
      with a clear error (via `validateClueBank` in `create`).
- [ ] The engine bundle keeps `@branchout/game-liar-liar` external and does not inline the clue JSON.
- [ ] `pnpm build && typecheck && test && lint && format:check` green across the workspace.
