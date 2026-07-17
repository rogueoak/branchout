# 0057 - Lone Leaf (cooperative single-clue word game)

## Problem

The insider program needs a cooperative word game with a genuine hidden-information twist. The
existing reference games are competitive (Trivia, Liar Liar) or a solo skill game (Teeter Tower);
none is a co-op game where the whole group wins or loses together, and none exercises the per-player
private channel (spec 0052) end to end. We want a short, warm, phone-first party game whose whole
point is a secret one player must not see - and a proof that the secret really is kept from that
player's device.

## Outcome

Lone Leaf: a cooperative single-clue word game for 3 to 7 players, `visibility: 'insider'`. Each
round one player is the Seeker (the role rotates so everyone takes a turn) and must guess a hidden
mystery word - the seed - that they alone cannot see. Every other player secretly writes ONE one-word
clue (a leaf). Before the Seeker looks, matching or invalid leaves wilt (are cleared): if two players
wrote the same word, both wilt, so only the leaves nobody else thought of survive. The Seeker sees the
survivors and takes one guess. Scoring is cooperative - a correct guess banks a point for every
player, and all players share the same standing. The seed is delivered ONLY to the non-Seekers via
the spec 0052 private channel; it never rides the broadcast prompt, viewer, or mid-round reveal, so
the Seeker's device never receives it until the guess resolves.

## Scope

- A new engine plugin package `@branchout/game-lone-leaf` (round-based, on the spec 0020 decision
  lifecycle + the spec 0052 private channel).
- A bundled sample seed bank (~60 single words across six themes) with a loader and a structural
  validator, following the spec 0041 sample pattern.
- A web UI module (config panel, viewer, remote) registered on the insider surface.
- A brand mark (a single oak leaf on a stem to the gold root #d2a463).
- Registry, marketing catalog, and game-library entries.
- Unit tests (dedupe/wilt including case + stem, Seeker rotation, secret-not-to-Seeker, co-op
  scoring), web component tests, and a real 360px end-to-end play-through.

Out of scope: the full seed bank (lives later in the private data repo, spec 0041); any competitive
or team scoring; a timer other than the standard move/guess windows.

## Approach

### Themed terminology

- Mystery word = **the seed**.
- The guesser = **the Seeker** (rotates each round by seat order).
- A one-word clue = **a leaf**; the players who write them = **the grove**.
- A duplicate/invalid clue = **wilted** (matching leaves wilt and are cleared).

### Engine (round-based, spec 0020 + spec 0052)

- `configure` - validate the host config (1-3 themes or `random`; 1-100 rounds, default 5); the leaf
  window is 90s.
- `startRound` - draw an unused seed and pick the Seeker (`seekerForRound` = seat `(round - 1) mod
  n`). The broadcast `prompt` carries the round, the theme, and WHO the Seeker is - never the seed.
  The seed is placed in `private[playerId]` for every NON-Seeker; the Seeker is absent from the map
  entirely.
- `collectMove` - record a non-Seeker's one-word leaf. The Seeker is refused (they write no leaf);
  a blank or a multi-word entry is refused with a private reason.
- `allSubmitted` - true once every connected non-Seeker has written a leaf.
- `reveal` - run the wilt: a leaf survives only when it is a single valid word, does not match the
  seed, and no OTHER player wrote a leaf with the same canonical stem (both of a duplicate pair
  wilt). Matching folds case and a light stem (a trailing plural / -ing / -ed), so "cat"/"cats" wilt
  together. The reveal streams the survivors + which wilted to everyone - but NEVER the seed word. It
  returns a `decision` (a 60s guess phase).
- `collectVote` - the Seeker's guess rides the vote `target` (free text); anyone else's vote is
  ignored.
- `allDecided` - true once the Seeker has guessed.
- `resolveDecision` - a correct guess (the seed word or an alias, using the same generous matching)
  banks +1 for EVERY player (co-op: a shared standing); a miss banks nothing for anyone. The final
  reveal names the seed (safe now the guess is in), the guess, whether it banked, and the leaves.

Randomness is seeded via `services.rng`; the seed bank loads via the injected asset loader.

### Web (spec 0023)

- The **viewer** is broadcast to every device, so it never shows the seed while a round is live: it
  names the Seeker + the theme while leaves are written, the surviving leaves while the Seeker
  guesses, and the full result (seed, guess, banked, wilted leaves) between rounds.
- The **remote** is the only surface the seed can appear on: a non-Seeker reads `state.private` to
  see their seed and writes a leaf; the Seeker has no private frame, so no seed, and only waits. In
  the guess phase the Seeker types one guess; everyone else waits.
- Config panel mirrors the engine's validation.

## Acceptance

- 3 to 7 players; `visibility: 'insider'` on both the plugin manifest and the web UI module.
- The seed reaches every non-Seeker via the private channel and NEVER the Seeker's device; a unit
  test proves the Seeker is absent from the `private` map and the prompt/reveal carry no seed, and
  the e2e proves the seed word appears on a non-Seeker's device but nowhere on the Seeker's.
- Matching leaves wilt (both of a duplicate pair), folding case and a light stem; unique valid leaves
  survive; a leaf equal to the seed wilts.
- The Seeker rotates by seat each round.
- A correct guess banks +1 for every player; all players share the standing (cooperative).
- A bundled sample seed bank of ~60 single words with a structural validator (id format + uniqueness,
  single-word seeds, no duplicate word per theme) - no count/spread gate.
- A brand mark carrying the gold root #d2a463 (asserted in a test).
- Unit, web component, and a 360px end-to-end play-through green in CI.
