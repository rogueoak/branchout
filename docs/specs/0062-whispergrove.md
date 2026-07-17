# 0062 - Whispergrove (two-team word-grid deduction)

## Problem

The insider wave needs its team game: a two-team word-grid deduction game where one player per team
alone sees a secret key and gives one-word clues to lead their team across a shared grid. It is the
most complex party game in the set - it combines teams (no engine team support), a live shared grid,
and a spymaster-style secret that must reach exactly two players and no one else. This is the game
that proves the spec 0052 private channel and a team-to-standings mapping end to end. (The term
"spymaster" describes the clue-giver ROLE generically; the game stands on its own invented identity
and terminology - no original brand name appears anywhere.)

## Outcome

- Four or more players split into two groves; each grove has one clue-giver (the Whisperer) who alone
  sees the secret key. Whisperers alternate giving a one-word-plus-number clue (a whisper); their
  grove taps leaves to link them.
- The key (each leaf's true role) is delivered ONLY to the two Whisperers via the spec 0052 private
  channel and is NEVER broadcast. A non-Whisperer never receives the key, even off the wire.
- A grove that reveals all of its own leaves first wins; a grove that taps the single instant-loss
  leaf (the Deadwood) loses immediately.
- The team result maps to per-player standings (every member of the winning grove shares the top
  rank), honoring the engine's individual-standings contract.
- The game is insider-only (`visibility: 'insider'`) on both the engine manifest and the web UI
  module, so it never leaks to the public surfaces.
- Mobile-first: the 5x5 grove and the controls read well at ~360px.

## Scope

**In**

- Engine: a new `@branchout/game-whispergrove` plugin on the LIVE model (spec 0044 shape): the shared
  grid state (words, revealed leaves, whose turn, the current whisper, guesses-left, the per-grove
  leaves-left race) lives in scratch and streams via `sim`; the KEY lives in scratch but is emitted
  ONLY to the two Whisperers via `startRound`/`tick`'s `private` return (spec 0052). `collectMove`
  applies a whisper (validated) or a tap (turn + role + guesses-left enforced).
- A bundled sample word bank (~400 single-noun words across four categories) under `data/` with a
  loader (`services.assets.forModule`) and a structural validator.
- Deterministic team + role assignment by seat order at configure; team result mapped to
  `Standing[]`.
- Web: a `whispergrove` UI module - a shared Viewer (the grove everyone watches) and a per-player
  Remote (the Whisperer composes a whisper and sees the key rings; a seeker taps leaves), a
  ConfigPanel (word-category selection), protocol decoders for the `sim` and the private key, and a
  catalog + library entry.
- A brand mark (grove-grid oak motif, single gold root #d2a463).
- Unit tests (key deal 9/8/7/1, whisper validation, tap outcomes including the Deadwood loss +
  turn-end, turn/role enforcement, key-only-to-Whisperers secrecy, team->standings) and a two-team
  e2e at 360px.

**Out**

- The full research-sourced word bank (later, in the private data repo per spec 0041).
- Configurable grid size / key split (always 5x5 and 9/8/7/1 in v1).
- Spectator hints or an "assassin can win" variant.

## Approach

**Themed terminology.** The grid is the Grove (25 word leaves). The teams are the Violet grove and the
Amber grove. The clue-giver is the Whisperer; the clue is a whisper (one word + a count). Neutral tiles
are saplings; the single instant-loss tile is the Deadwood.

**Live model.** Whispergrove implements `tick` (which marks it live and re-emits the snapshot + the
Whisperers' secret for join catch-up) but has no autonomous motion - all progress comes from
`collectMove`. The board is fully serializable in scratch, so `disposeLive` is a no-op.

**The key (spec 0052).** The scratch holds `key: LeafRole[]` (violet / amber / sapling / deadwood per
leaf). `startRound` and `tick` return `private: { [whispererId]: { key } }` keyed ONLY by the two
Whisperer player ids; the engine delivers each entry only to that device. The broadcast `sim` carries
the words and only the REVEALED role of a revealed leaf - a hidden leaf's role is never in the
broadcast. A test proves a seeker is absent from the private map and the broadcast has no `key` field.

**Turn + role enforcement.** `collectMove` returns `{ rejected: { reason } }` (a targeted reply) for:
a move from the wrong grove, a whisper from a non-Whisperer, a whisper that is multi-word / a word on
the grove / out of range, a tap before a whisper, a tap from the Whisperer, a tap with no budget, a
tap on a revealed or out-of-range leaf. A correct (own) leaf keeps the turn (down to zero taps); a
sapling or enemy leaf ends the turn; the Deadwood ends the game for the tapping grove.

**Teams.** Seats are assigned by seat order (even -> Violet, odd -> Amber; the first of each grove is
its Whisperer). The team result maps to standings by scoring the winning grove 1 and the losing grove
0, so `rankStandings` groups each grove into a shared rank.

## Acceptance

- The key deals exactly 9 starting-grove / 8 other-grove / 7 sapling / 1 Deadwood over 25 leaves,
  deterministically under a seeded rng.
- A whisper is accepted only when it is a single token, not a word on the grove, with N in
  1..(remaining own leaves), from the active grove's Whisperer; it sets the tap budget to N + 1.
- A tap reveals a leaf and resolves: own leaf keeps the turn, sapling/enemy passes the turn, Deadwood
  ends the game for the other grove; out-of-turn / wrong-role / no-budget / revealed / out-of-range
  taps are rejected.
- The secret key reaches ONLY the two Whisperers (both, in full) and NO seeker, via `startRound` and
  `tick`; the broadcast prompt/sim never contains a hidden leaf's role. (Unit test asserts this.)
- The winning grove's members all share the top standing rank.
- The game is insider-only on the engine manifest and the web module.
- A two-team e2e drives a real whisper + taps to a scored end (a winner + final standings) at 360px.
- typecheck, lint, unit tests, and the web build pass; all source is ASCII-only.
