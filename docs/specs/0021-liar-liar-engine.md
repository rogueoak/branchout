# 0021 - Liar Liar: the game (engine plugin)

## Problem

Liar Liar is Branch out's second game and the proof that the plugin architecture (specs 0018-0020)
carries a game whose shape is nothing like Trivia. It is a Fibbage/Balderdash-style bluffing game:
the viewer shows an improbable-but-true clue, players invent a convincing fake answer, then everyone
guesses which of the revealed answers is the real one. It exercises exactly the generic capabilities
0020 added - a timed submission phase with real-time rejection, and a post-reveal guess phase.

This spec is the engine-side game logic only. Its clue content is spec 0022 (as Trivia split
`0008` logic from `0009` content), and its player-facing web client is spec 0023. Because the content
lands in 0022, this spec does not wire Liar Liar into the engine boot (that happens with the content);
it ships the package, tested against synthetic clues.

## Outcome

A `@branchout/game-liar-liar` package implements a `GamePlugin` on the 0020 decision lifecycle: a host
configures categories + rounds; each round the engine streams a clue, players submit a unique fake
within 90s (duplicates and the real answer are rejected privately), the reveal lists all fakes plus
the truth, players guess within 30s, and scoring awards 100 for guessing the truth and 50 to a fake's
author for each player it fooled. A full game runs end to end through the unchanged `GameEngine`,
proven by an integration test.

## Scope

In:
- **`@branchout/game-liar-liar`** package (mirrors `@branchout/game-trivia` tooling; deps
  `@branchout/protocol` + `@branchout/game-sdk`; `files: ["dist","data"]`):
  - **Config + schema**: `categories` (1-3 of `people, places, events, sports, food, nature, animals,
    things`, or `random` = draw across all) and `rounds` (1-100, default 10). `configSchema`
    validates/normalizes and rejects out-of-range.
  - **Clue bank contract**: a `LiarLiarClue { id, category, clue, answer, aliases? }`, a
    `loadClueBank(assets)` that reads `data/liar-liar/<category>.json` via the injected `AssetLoader`,
    and a `validateClueBank` (schema, id + per-category uniqueness). Real data is spec 0022; this spec
    ships the loader/validator and tests them with synthetic clues via the in-memory asset loader.
  - **Module** on the decision lifecycle: `configure` (90s answer window), `startRound` (draw an
    unused clue from the chosen categories via the injected rng; `random` draws across all), a
    `collectAnswer` that normalizes and **rejects** a fake equal to the real answer/alias or to
    another player's fake (`{ rejected: { reason } }`, a vague message), `allAnswered`, a `reveal`
    that shuffles [all fakes + the truth] into options and returns `{ decision: { windowMs: 30000 } }`
    with no scores yet, a `collectVote` for the `guessing` phase (target = chosen option; a self-fake
    pick is ignored), `allDecided`, and a `resolveDecision` that scores (100 per correct guess to the
    guesser; 50 per fooled player to the fake's author) and emits the final reveal (truth +
    attribution + pick counts). `leaderboard`/`advance`/`endGame` rank by score.
  - Its own small `matching` (normalize + normalized-exact equality) so it does not depend on Trivia.
  - `capabilities.minPlayers = 2`.
- **Tests**: unit coverage of the schema, clue draw (no-repeat, category filter, `random`),
  rejection (duplicate + correct-answer), reveal option shuffle/attribution, and `resolveDecision`
  scoring (correct guess, per-fool 50 incl. a fake fooling several, ties, ignored self-pick, a player
  who never submitted a valid fake); plus a **full-game engine integration test** that registers
  `liarLiarPlugin` through `registerPlugins` with test services (in-memory clue bank + seeded rng) and
  drives a complete game via `GameEngine` + in-memory store/pubsub + `ManualScheduler` - the proof a
  brand-new game plugs into the **unchanged** engine.

Out:
- The real clue content and wiring Liar Liar into the engine boot - spec 0022. The web client and
  control-plane game selection - spec 0023. LAN dev - spec 0024. No per-guess fuzzy matching (fakes
  dedupe on normalized-exact, so two genuinely different fakes are never collapsed).

## Approach

- **Built entirely on 0020's generic hooks** - `answerWindowMs` (90s submit), `collectAnswer`'s
  `rejected`, `reveal`'s `decision`, `resolveDecision`/`allDecided`. The engine needs no change; if it
  did, the 0020 seam would be wrong. The integration test is the assertion of that.
- **Deterministic shuffle + draw off the injected rng** so a seeded test pins the option order and
  clue choice, and every device renders the same options (the engine broadcasts the reveal).
- **Reject vaguely, dedupe exactly.** The rejection reason never says whether it collided with the
  truth or another fake ("someone already submitted that"); matching is normalized-exact so a clever
  but distinct fake is never wrongly rejected.
- **Prune per-round scratch** (only `usedIds` + the current round's clue/submissions/options/guesses)
  per the state-size learning.

## Acceptance

- [ ] `configSchema` accepts 1-3 categories or `random` and rounds 1-100 (default 10); rejects
      out-of-range/unknown categories.
- [ ] A duplicate fake and a fake equal to the real answer are both rejected privately with a vague
      reason and no scratch write; a distinct fake is accepted.
- [ ] The reveal lists every fake plus the truth as shuffled options; guessing the truth scores 100,
      and a fake scores its author 50 per player fooled.
- [ ] A clue never repeats within a game; `random` draws across all categories.
- [ ] The full-game integration test drives configure -> submit(+reject) -> reveal -> guess -> score
      -> leaderboard -> end through the unchanged `GameEngine`, asserting scores and final standings.
- [ ] `pnpm build && typecheck && test && lint && format:check` green across the workspace.
