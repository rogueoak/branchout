# 0059 - Odd Bird: a hidden-role location game (insider)

## Problem

Odd Bird is Branch out's first HIDDEN-ROLE deduction game and the first to depend on the per-player
private channel (spec 0052). A location - the roost - is drawn; every player is dealt the SAME roost
plus a distinct role at it (a perch), except one random player, the odd bird, who is told only that
they are the odd bird and do not know the roost. Players ask each other pointed questions out loud
(out of band); answers must fit the roost without naming it. The flock tries to expose the odd bird;
the odd bird bluffs and tries to work out the roost. When the flock is ready (or the timer runs out)
anyone calls the flush - an accusation vote - and the odd bird gets one guess at the roost.

The whole point of the game is the secret. Each player's card (roost + perch, or "you are the odd
bird") must reach ONLY that player. The engine broadcasts `state`/`prompt`/`reveal` to every device,
so a client-side hide would leak the secret over the wire. Odd Bird therefore rides the spec 0052
`private` seam: the module emits a payload keyed per player that the engine delivers only to that
player's socket(s), and never places the secret in the broadcast frame.

The game is insider-only (`visibility: 'insider'`) until it graduates: it appears only on the insider
surface (spec 0043).

## Outcome

A `@branchout/game-odd-bird` package implements a `GamePlugin` on the generic decision lifecycle
(spec 0020) with per-player private payloads (spec 0052). A host picks the roost categories; the
engine deals a roost, one odd bird, and a distinct perch per flock member, delivering each card
privately; runs a long question window; opens the flush; collects the accusation vote and the odd
bird's roost guess; and resolves win/loss to standings. The flock wins by flushing the odd bird; the
odd bird wins by surviving the flush or naming the roost. A full game runs end to end through the
unchanged `GameEngine`, proven by an integration test, and a real three-player play-through is proven
by an e2e at a 360px phone viewport. A test proves player B never receives player A's card and the
odd bird never receives the roost.

## Scope

In:

- **`@branchout/game-odd-bird`** package (mirrors `@branchout/game-liar-liar` tooling; deps
  `@branchout/protocol` + `@branchout/game-sdk`; `files: ["dist","data"]`):
  - **Config + schema**: `categories` (1 or more of `everyday, outdoors, travel, events,
    fantastical`, or `random` = draw across all; default `random`). `configSchema` validates/
    normalizes and rejects an unknown or duplicate category.
  - **Roost bank contract**: an `OddBirdRoost { id, category, name, perches[] }`, a
    `loadRoostBank(assets)` that reads `data/odd-bird/<category>.json` via the injected `AssetLoader`,
    and a `validateRoostBank` (schema, id format + uniqueness, no duplicate name per category, at
    least `MAX_PLAYERS - 1` distinct perches per roost so the largest flock is dealt unique perches).
    A small but real SAMPLE bank (~30 roosts across the five categories) ships under `data/`; a fuller
    bank would later live in the private data repo (spec 0041).
  - **Module** on the decision lifecycle. One location game = one round with a long question window:
    - `configure`: rounds = 1, `moveWindowMs` = the question window (8 minutes).
    - `startRound`: draw a roost from the chosen categories via the injected rng; pick the odd bird
      and deal a distinct perch to each flock member (all off the rng). Emit each player's card on the
      `private` map (the odd bird gets `{ role: 'odd-bird' }`; a flock member gets `{ role: 'flock',
      roost, perch }`). The broadcast prompt carries NO secret (only the table size + category).
    - `collectMove`: the only move is calling the flush (`'flush'`), which ends the question window
      early. Any other move is ignored.
    - `allSubmitted`: true once the flush is called (else the long timer closes the window).
    - `reveal`: opens the flush as the generic decision phase (`decision: { windowMs }`). The reveal
      lists the accusable players and the roost slate the odd bird guesses from (the true roost plus
      decoys, shuffled) - still naming no secret. Re-emits each private card so it survives the phase.
    - `collectVote`: a flock member accuses a player (`target` = a player id); the odd bird guesses a
      roost (`target` = `roost:<roostId>`). An accusation by the odd bird, or a roost guess by a flock
      member, is ignored.
    - `allDecided`: every connected player has accused (flock) or guessed (odd bird).
    - `resolveDecision`: the flushed bird is the single most-accused player (a tie flushes no one).
      The flock wins iff the flushed bird is the odd bird - then each flock member scores
      `FLOCK_WIN_POINTS` (100). Otherwise the odd bird scores `SURVIVE_POINTS` (100). Naming the roost
      scores the odd bird `GUESS_POINTS` (150) either way. The final reveal names the roost, the odd
      bird, the flushed bird, and the outcome. `leaderboard`/`advance`/`endGame` rank by score;
      `advance` is always done (one game per session).
  - Determinism: all randomness (roost draw, odd-bird pick, perch deal, decoy shuffle) is seeded via
    `services.rng`; unit tests pin a seed.
- **Engine registration**: the plugin is added to the engine boot list (`apps/game-engine/src/
  index.ts`) and the worker `PLUGINS` list (`.../worker/game-worker.ts`), and to the engine package
  deps.
- **Web UI module** (`apps/web/lib/games/odd-bird/`, spec 0023): a `GameUiModule` with
  `visibility: 'insider'`, a `ConfigPanel` (category multi-select), a `Viewer` (the shared screen that
  never shows a secret), and a `Remote` (the private controller that shows this player's own card from
  `state.private`, a "call the flush" button, and the accusation/guess ballots). Payload decoders in
  `protocol.ts` for the public prompt, the private card, the flush reveal, and the final result.
  Registered in `registry.ts`, with a `catalog.ts` marketing entry and a `library.ts` entry.
- **Brand**: `packages/brand/src/oddbird.ts` exporting the 512x512 mark (a flock perched on an oak
  branch with one odd bird apart at the tip; the single gold root `#d2a463`), wired into the brand
  package `exports` and tsup entries, with a mark test asserting the gold root.
- **Tests**: engine unit tests (role dealing incl. exactly-one odd bird, per-player secrecy, vote
  resolution both outcomes, the odd-bird guess, a tie), a full-lifecycle integration test, web
  component tests, and an e2e play-through at 360px.

Out:

- A fuller research-sourced roost bank (private data repo, spec 0041).
- Multi-game sessions / rematch (one location game per session for now).

## Approach

Odd Bird is round-based with a single long round, reusing the generic decision (guess) phase for the
flush. The one novel dependency is spec 0052: `startRound` and `reveal` return a `private` map keyed
by player id, and the engine delivers each entry only to that player. The secret NEVER appears in the
broadcast `prompt`/`reveal`. The accusation vote and the odd bird's roost guess both ride the single
`vote` frame: a roost guess is namespaced with a `roost:` target prefix so the module tells the two
apart, while a plain player-id target is an accusation.

## Acceptance

- Configure rejects an unknown/duplicate category and defaults to `random`.
- `startRound` deals exactly one odd bird; every flock member shares one roost and holds a distinct
  perch; each card is on the `private` map and NOT in the broadcast prompt.
- Per-player secrecy: player B never receives player A's card, and the odd bird's card carries no
  roost (proven by a test).
- The flush resolves BOTH outcomes: the flock scores when it flushes the odd bird; the odd bird
  scores for surviving when the flock fingers the wrong bird (a tie flushes no one). Naming the roost
  scores the odd bird a bonus either way.
- A full game runs through the unchanged engine to final standings (integration test), reached through
  a real flush + resolve (not hand-set scratch).
- The web viewer never shows a secret; the remote shows only this player's own card.
- The game is insider-only: filtered from the public picker/pages/sitemap.
- Green typecheck/lint/unit tests/build; a 360px e2e drives a full three-player play-through.
