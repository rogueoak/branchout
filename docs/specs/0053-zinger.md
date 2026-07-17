# 0053 - Zinger

Status: proposed

## Problem

The insider games program needs a funny-answer party game: a phone-first party game where
everyone answers a silly prompt and then votes on whose answer landed hardest. Branch Out already
ships a round-based collect-then-reveal-then-decide pipeline (the bluffing game on spec 0020's
generic decision lifecycle), but nothing that pits two player-written answers head to head and
scores them by a live vote. Zinger fills that gap and proves the party pipeline reads cleanly onto
the game library, catalog, and insider-surface foundations (specs 0043, 0050, 0051) without any new
engine capability.

## Outcome

A new insider-only game, **Zinger**, playable end to end on the insider surface:

- The host configures a round count and starts the room; every player joins on their own phone.
- Each round shows **the setup** (a short, clean fill-in-the-blank or open prompt). Every player
  types a short funny answer - **a zinger**.
- Two zingers are pitted head to head in **the face-off**. Everyone who did not write either zinger
  votes for the funnier one.
- The winning zinger's author scores one point per vote, with **a clean sweep** bonus when the vote
  is unanimous. The face-off's authors are revealed after the vote, and the standings update.
- Highest total after the last round wins.

Zinger ships with a small sample bank of clean, ASCII prompts, a mobile-first (360px) viewer and
remote, its brand mark, a marketing catalog entry, a library entry (categories/tags/rules), unit
tests, web component tests, and an insider happy-path e2e.

## Scope

In scope:

- A new engine plugin package `@branchout/game-zinger` on the generic decision lifecycle (spec 0020),
  `visibility: 'insider'`.
- A sample prompt bank under the package `data/` with a loader and a structural validator.
- A web UI module (config panel, viewer, remote) registered on the insider surface.
- Brand mark, marketing catalog entry, library entry.
- Deterministic engine unit tests, web component tests, and an insider e2e for the happy path.

Out of scope:

- Multiple face-offs per round (one face-off per round keeps the mapping onto the existing
  one-reveal, one-decision lifecycle clean; more matchups is a later change).
- A private per-player channel (spec 0052). A player only needs to see their own setup while
  answering, and seeing another player's setup is not a cheat, so no secret is broadcast.
- The full research-sourced prompt bank (it would later live in the private data repo per spec 0041).

## Approach

### Terminology

- Prompt = **the setup**.
- Answer = **a zinger**.
- The head-to-head pairing = **the face-off**.
- A unanimous vote = **a clean sweep** (a bonus).

### Lifecycle mapping (spec 0020 hooks)

Zinger reads onto the same collect -> reveal -> decision (vote) -> resolve shape the bluffing game
uses, so it needs no new engine hooks:

- `configure`: validate the host config (round count); set the answer window to 90s.
- `startRound`: draw an unused setup from the configured pool; broadcast it as the prompt.
- `collectMove`: record a player's zinger (trimmed). Reject an empty answer (a private reply to that
  device only). A player may freely change their own zinger before the window closes.
- `allSubmitted`: true when every connected player has submitted a zinger.
- `reveal`: deterministically (seeded rng) pick two distinct authors and pit their zingers head to
  head - the face-off. Broadcast the two zingers WITHOUT their authors, and open the `decision`
  (vote) phase. If fewer than two players submitted, the round scores nothing and reveals directly.
- `collectVote`: record a vote for one of the two face-off options. Reject a vote from either
  face-off author (they cannot vote on their own face-off) or for an unknown option.
- `allDecided`: true when every eligible voter (everyone except the two authors) has voted.
- `resolveDecision`: the zinger with more votes wins; ties split no points. The winner's author
  scores 1 point per vote for their zinger. A clean sweep - every eligible voter (at least two)
  voted for the same zinger - adds a bonus. Broadcast the final reveal: both zingers with their
  authors and vote tallies, and the winner.

### Determinism

All randomness (the setup draw, the face-off author pick) is taken from the injected `services.rng`,
so a seeded unit test pins the drawn setup and the chosen pairing.

### Content bank

`data/zinger/prompts.json` holds ~50 short, funny, clean, ASCII fill-in-the-blank / open prompts.
A loader reads it through the injected asset loader (`services.assets.forModule`), and a structural
validator checks per-item structure only (id format `prompt-NNN` + uniqueness, non-empty text, no
duplicate text) - no count/spread gate, matching the bluffing game's bank validator.

### No brand-name references

Zinger stands on its own invented identity, described purely by mechanics. No real-world brand-name
game is named anywhere in the spec, code, comments, or copy.

## Acceptance

1. A host on the insider surface can create a room, pick Zinger, configure a round count, and start.
2. Each round shows the setup; every player can type and submit a zinger; an empty zinger is
   rejected on that device only.
3. On reveal, two zingers appear head to head (the face-off) without their authors, and everyone who
   did not write either can vote for one.
4. The winning zinger's author scores one point per vote; a unanimous vote (a clean sweep, at least
   two voters) adds a bonus; a tie splits no points.
5. After the vote, both zingers are attributed to their authors with tallies, and the standings
   update; the highest total after the last round wins.
6. Zinger is insider-only: it appears only on the insider surface and never in the apex picker or
   for a non-insider.
7. The prompt bank loads and validates at engine boot; a malformed bank aborts the start with a
   clear error.
8. Engine unit tests (deterministic, seeded), web component tests, and an insider happy-path e2e at
   360px cover the flow.
