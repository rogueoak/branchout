# 0063 - Sketchy: a draw-and-guess party game (insider-only)

## Problem

We want another party game for insider testers: a draw-and-guess game where the fun is drawing a
private prompt, then bluffing everyone with fake answers and sniffing out the real one. It must be a
real game on our platform (lobby, config, rounds, WebSocket), it is mobile-web first, and it turns on
**hidden information** - each player must be given a prompt only they can see, or the whole guessing
stage collapses. It ships behind the existing insider surface (spec 0035) so it never touches the
public catalog until it is ready.

The heart of the game: everyone draws a **secret prompt** on a phone-sized canvas within a timer,
then for each drawing every other player invents a fake prompt (a decoy); the decoys plus the true
prompt are shuffled and shown, and players pick the one they think is real. This reuses the Liar Liar
guess/decision scoring shape (spec 0021): points for guessing the truth, points to a decoy's author
for each player it fools.

## Outcome

- An insider can create a room, pick **Sketchy** (visible only to insiders), start it with 3-8
  players, and play across a configurable number of rounds.
- Each round has two stages:
  - **Stage A (draw):** every player is privately given a different **seed** (the prompt) and draws
    it freehand on a canvas within a timer. The drawing is captured as compact serialized vector
    **strokes** (arrays of points plus a color) and submitted as the player's **sketch**.
  - **Stage B (bluff and guess):** for each submitted sketch, every *other* player writes a fake
    prompt (a **decoy**). The decoys plus the **true seed** are shuffled and shown; each player picks
    which one they think is the real seed.
- **Scoring** (reused from Liar Liar): a player scores for picking the true seed, and a decoy's author
  scores for each player their decoy fools. Highest total across all rounds wins.
- A player's **seed is a secret**: it is delivered only to that player's own device via the spec 0052
  per-player private channel and never broadcast, so no other player can read another player's seed
  off the wire before it is revealed.
- The drawing surface works at ~360px on touch (pointer events, `touch-action: none`, pointer
  capture) - mobile-first (CLAUDE.md rule 1). The viewer replays every submitted sketch read-only.
- The game is absent from the public game picker, public game pages, and the sitemap. A non-insider
  cannot see or start it.

## Themed terminology

- Prompt = **the seed**.
- Your drawing = **your sketch** (drawn with a **twig** on the **bark** - the canvas).
- Fake answers = **decoys**.
- The real prompt hidden among the decoys = **the true seed**.

## Scope

**In**

- A new engine game plugin (`packages/games/sketchy`) on the round-based decision lifecycle
  (spec 0020), two-stage per round: a **draw** collect stage whose move is a serialized sketch, then a
  **decoy** collect + **guess** decision stage per sketch reusing the Liar Liar attribution/scoring
  shape.
- Per-player secret seeds via the spec 0052 `private` seam: `startRound` returns
  `private: { [playerId]: { seed } }` so each player receives only their own seed; the broadcast
  `prompt` never carries any seed.
- A compact, serializable stroke format for a sketch: an array of strokes, each a color plus a flat
  array of quantized point coordinates; a round-trip (serialize -> replay) helper and a size cap so a
  submission cannot be unbounded.
- A bundled sample **seed bank** (~120 prompts across a few categories) under the package `data/`,
  read through the injected asset loader, with a structural validator (id format + uniqueness,
  required fields).
- The web UI module (`apps/web/lib/games/sketchy`): a freehand drawing canvas (Viewer during draw for
  the local player, and a read-only replay of each sketch during guess), a Remote that captures the
  sketch and submits it and later picks the real seed, a config panel, and payload decoders.
- Catalog (marketing) + library (spec 0051) entries, a brand mark, and registration in the engine and
  web registries.
- Unit tests (stroke serialize/replay round-trip, decoy dedupe + truth rejection, guess/decoy
  scoring, per-player seed secrecy), a web component test, and a multiplayer end-to-end test at 360px
  that draws, submits decoys, votes, and reaches scoring.

**Out**

- The full production seed bank (the public repo ships a small sample; the full bank lives in the
  private data repo per spec 0041).
- Server-side image rasterization or export of sketches (the sketch stays vector strokes replayed in
  the browser).
- Freeform brush size / eraser tooling beyond a small fixed palette (a compact, dependable drawing
  surface first).

## Approach

### Engine: two stages on the decision lifecycle

Each round maps onto the generic lifecycle (spec 0020) the same way Liar Liar does, but the round
runs in two stages tracked in scratch:

- `configure` -> validate the config (rounds); `moveWindowMs` is the draw timer.
- `startRound` -> assign each player a distinct unused **seed** from the bank. The broadcast `prompt`
  carries only the round number and a "draw your seed" cue; each player's actual seed goes out in
  `private: { [playerId]: { seed } }` - never in the broadcast frame.
- **Stage A (`collecting`, draw):** `collectMove` records a player's sketch (serialized strokes),
  rejecting an empty or oversized sketch. `allSubmitted` closes when every connected player has drawn.
- `reveal` -> pick the first sketch to guess on and build the shuffled option set for it (that
  sketcher's true seed + every decoy other players will write). Because decoys are written per sketch,
  the reveal opens the **decoy** sub-stage: the guessable options are collected, then the guess.

  To keep this on the single generic decision phase, the round resolves one sketch at a time: the
  module tracks a `sketchIndex` in scratch and, in `resolveDecision`, advances to the next sketch by
  re-opening a decision until every sketch has been guessed, then scores and moves to the leaderboard.
  (Decoys are collected during `collecting` per sketch via `collectMove`; the truth-rejection and
  duplicate-rejection logic is the Liar Liar `matching` logic reused.)

- **Scoring** mirrors Liar Liar: guessing the true seed scores `CORRECT_POINTS`; a decoy's author
  scores `FOOL_POINTS` per player fooled.
- `advance` -> done when the configured round count is reached.

The exact per-sketch sequencing detail is an implementation choice recorded here for reviewers: the
module is a pure set of callbacks over `RoundContext`, seeded via `services.rng`, so a fixed seed
pins the sketch order, the seed assignment, and the option shuffle in tests.

### Stroke format

A sketch is `{ strokes: Stroke[] }`, where a `Stroke` is `{ color: string; points: number[] }` and
`points` is a flat `[x0, y0, x1, y1, ...]` array of integer coordinates on a fixed logical canvas
(0..1000 on each axis, so the format is resolution-independent and compact). Helpers serialize a
sketch to a JSON string for the move channel and parse it back, clamping to a maximum stroke and point
count so a submission is bounded. The viewer scales the logical coordinates to its rendered size and
replays each stroke as a path - read-only, no interaction.

### Secret seeds (spec 0052)

`startRound` returns `private` keyed by player id; the engine delivers each entry only to that
player's socket(s) and replays it on reconnect. The web UI reads `state.private` for the local
player's seed. A unit test drives `startRound` and asserts a non-recipient's private payload never
contains another player's seed (the broadcast `prompt` carries no seed at all).

### Web

The Remote is the drawing surface during Stage A: a canvas with pointer events, `touch-action: none`,
and pointer capture so a drag never scrolls the page (mobile-first, ~360px). It reads the local seed
from `state.private`, captures strokes, and submits the serialized sketch. During Stage B the Remote
shows the current sketch (replayed read-only) and the shuffled options to pick from - hiding the
player's own decoy, which they cannot pick. The Viewer replays sketches on the shared screen and shows
the round result and standings. Config, validation, and decoders mirror the engine.

## Acceptance

- An insider host can configure and start Sketchy with 3-8 players; a non-insider cannot see or start
  it.
- Each round privately deals a distinct seed to every player; a player's seed is never present in any
  broadcast frame, only in that player's `private` payload (proven by a unit test).
- A player draws on the canvas at 360px (pointer events, no page scroll), and the sketch is captured
  and submitted as serialized strokes; a serialize -> replay round-trip preserves the strokes (unit
  test).
- For each sketch, other players submit decoys; a decoy equal to the true seed or a duplicate of
  another player's decoy is rejected (unit test); the true seed and decoys are shown shuffled and a
  player cannot pick their own decoy.
- Scoring awards points for picking the true seed and points to a decoy's author per player fooled;
  final standings rank the winner (unit + integration test).
- The seed bank sample is structurally valid (id format + uniqueness, required fields) and loads
  through the asset loader (unit test).
- A multiplayer end-to-end test at 360px drives a full round: draw, submit decoys, vote, and reach a
  scored leaderboard.
- typecheck, lint, unit tests, and the web build pass; the brand mark carries the gold root #d2a463.
</content>
