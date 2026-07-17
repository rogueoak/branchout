# 0058 - Same Branch: a spectrum-guessing party game (insider-only)

## Problem

We want another insider test game that leans on reading a group's shared intuition rather than trivia
knowledge or bluffing. **Same Branch** is a spectrum-guessing game: a dial spans two opposites (the
**branch**), a hidden target (the **bud**) sits somewhere on it, one player (the **Reader**) alone
sees the bud and gives a one-line clue (a **hunch**), and everyone else moves a pointer (the **sap
line**) to guess where the bud is. Scoring is by closeness. It must be a real game on our platform
(lobby, config, rounds, WebSocket), 2-8 players, mobile-first, and - because the bud is the whole
point of the game - the bud must be a genuine server-side secret that only the Reader ever receives.

It ships behind the existing insider surface (spec 0035) so it never touches the public catalog until
it is ready.

## Outcome

- An insider can create a room, pick **Same Branch** (visible only to insiders), configure it (1-3
  spectrum categories or random, a round count, and a scoring mode), and play with 2-8 players on
  their phones.
- Each round shows a branch running between two opposites (like "cold" and "hot"). One player is the
  **Reader** (the role rotates by seat each round). The Reader alone sees the hidden **bud** and reads
  a one-line **hunch**; everyone else drags the **sap line** to where they think the bud is and locks
  in. The reveal discloses the bud and scores each guess by closeness.
- Scoring is by distance in bands: a **bullseye** (within 4 of the bud) is worth 4, **close** (within
  10) 3, **near** (within 18) 2, and a wild **miss** 0.
- Two scoring modes: **free-for-all** (each player scores their own closeness; most points wins) and
  **co-op** (the whole grove pools every guess into one shared score chasing a high total).
- **The bud is a real secret.** It is delivered ONLY to the Reader's device via the per-player private
  channel (spec 0052) and is NEVER put in the broadcast prompt or in any payload before the reveal. A
  non-Reader's device never receives the bud over the wire.
- The game is absent from the public game picker, public game pages, and the sitemap. A non-insider
  cannot see or start it.

## Scope

**In:** a new engine game plugin (`packages/games/same-branch`) - a deterministic round-based module
with a bundled sample spectrum bank (~120 opposite pairs across six categories, a loader + a
structural validator); its web UI module (config panel, a shared viewer, and a per-player remote with
an interactive branch dial); the per-player private delivery of the bud to the Reader (spec 0052);
free and co-op scoring; a brand mark + marketing/library entries; unit + component + e2e tests; this
spec and the features doc.

**Out:** the optional "opposing team bets left/right of the guess" side wager from the paper design
(deferred); the full research-sourced spectrum bank (a small sample ships here; the full bank later
lives in the private data repo per spec 0041); per-category count/coverage gates on the bank; sounds;
score persistence. Turn-based peers (Trivia, Liar Liar) and live peers (Teeter) are untouched.

## Approach

### Engine module (round-based, spec 0020 lifecycle)

The module maps onto the generic round lifecycle:

- `configure` - validate the host config (categories, rounds, mode); freeze the seat order (so the
  Reader rotation is deterministic); set the per-round move window to 120s.
- `startRound` - draw an unused spectrum for the round; pick a hidden bud position (an integer 8-92,
  kept off the extremes so a hunch always has room both ways) off the seeded rng; resolve the round's
  Reader from the frozen seat order (round N -> seat N-1, wrapping). Broadcast a `prompt` carrying the
  branch ends, the category, and who the Reader is - **but no bud**. Return `private: { [readerId]:
  { round, bud, left, right } }` so the engine delivers the bud only to the Reader (spec 0052).
- `collectMove` - if the mover is the Reader, record their hunch (reject an empty one); otherwise
  record their sap-line position (parse an integer, clamp to 0-100, reject a non-number).
- `allSubmitted` - the round is complete when the Reader has given a hunch and every connected guesser
  has set a sap line, so the engine can auto-close.
- `reveal` - score each guess by closeness (`scoreGuess`) into the bands above; return a `reveal`
  payload disclosing the bud, the hunch, and every scored guess.
- `leaderboard` / `advance` / `endGame` - standings between rounds and at the end. In free mode this
  is the ordinary per-player ranking; in co-op every player shares the pooled total at rank 1.

Determinism: all randomness (spectrum draw, bud position) is off `services.rng`, so a seeded test
pins the whole game.

### The bud secret (spec 0052)

The bud never appears in the broadcast `prompt` or in any pre-reveal payload. `startRound` returns it
in the `private` map keyed by the Reader's id; the engine delivers each private entry only to that
player's connection(s) and never broadcasts it. The web reducer already folds the targeted `private`
frame into `state.private` (spec 0052), so only the Reader's device can read the bud; the reducer's
defense-in-depth check also drops a mis-targeted private frame. A unit test asserts the bud is present
only in the Reader's private entry and never in the prompt, for every round.

### Content bank

A sample bank of ~120 opposite pairs across six categories (`senses`, `feelings`, `everyday`,
`nature`, `people`, `wild`), loaded via the injected asset loader and validated structurally (id
format + uniqueness, non-empty and distinct ends, no duplicate pair in a category) at boot - no
count/coverage gate, mirroring the Liar Liar bank (spec 0021, spec 0041).

### Web UI (mobile-first, 360px)

- **ConfigPanel** - a Random/pick-categories toggle (capped at 3), a free/co-op scoring toggle, and a
  round count, validated against the same rules the engine enforces.
- **Viewer** (shared screen) - shows the branch ends, the Reader, the hunch once given, and at reveal
  paints the bud and every guess on the branch with a scored result. The bud is never rendered here
  before the reveal.
- **Remote** (per player) - the Reader sees the bud on the branch (read from `state.private`) and
  types a hunch; every other player drags the sap line on an accessible, touch-first **branch dial**
  and locks in. The dial is a 360px-wide pointer target with a large touch handle and full keyboard
  operation (arrow keys, Page keys, Home/End) as an ARIA slider.

## Acceptance

- An insider can host, configure, and play a full Same Branch game 2-8 players; a non-insider cannot
  see or start it.
- The Reader rotates by seat each round; the Reader gives a hunch; guessers set a sap line; the reveal
  scores by closeness in the 4/3/2/0 bands.
- Free mode ranks per player by points; co-op pools every guess into one shared score.
- **The bud is delivered only to the Reader (spec 0052) and never appears in the broadcast prompt or
  any pre-reveal payload** - proven by a unit test that checks every round.
- The bank loads and validates; the validator rejects a malformed item (bad id, unknown category,
  empty/identical ends, duplicate pair).
- Unit tests cover scoring bands, reader rotation, the bud secret, config validation, and a full
  multi-round play-through to final standings driven by real moves. Web component tests cover the
  dial, the Reader/guesser remote (including that a non-Reader never receives the bud), the viewer,
  and the config panel. An e2e drives a real two-insider one-round game at 360px - the Reader reads a
  hunch, a guesser drags the dial and locks in, and the game scores to final standings - and asserts
  only the Reader sees the bud.
- typecheck, lint, unit + component tests, and the web build pass; source, data, and docs are ASCII.
