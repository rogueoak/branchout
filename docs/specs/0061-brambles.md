# 0061 - Brambles (two-team forbidden-words game)

## Problem

Branch Out's insider program needs a fast, social, team word game for four or more players. The
classic "describe a target word without saying it or any of a short forbidden list" party game is a
proven format, but it normally relies on a physical card, a human buzzer, and describing out loud.
We want an online, phone-first version where the app IS the card, the referee, and the scorekeeper,
and where the target and forbidden words are a genuine secret held by exactly one player - a secret
that must never travel to any other device.

## Outcome

Brambles ships as an insider-only (`visibility: 'insider'`) two-team game. Terms are themed to the
Branch Out grove and carry no original brand name:

- The target word is the **bloom**.
- The forbidden words are the **thorns** (exactly five per card).
- The describer is the **Guide**.
- A forbidden-word slip is a **prick** (the card wilts - no point).
- A team's timed turn is a **sprint**; the teams are the **Violet grove** and the **Amber grove**.

Players split into two groves by seat. Each sprint, one grove is on the clock: its Guide alone sees
the current card's bloom and thorns and types clues; the grove types guesses; a correct guess scores
a bloom and draws the next card. If the Guide's clue contains the bloom, a thorn, or an obvious
variant, the engine pricks the card (no point, new card). The Guide may skip. When the sprint timer
expires the other grove takes its turn. After all sprints, the grove with the most blooms wins; every
member of a grove shares that grove's final rank.

## Scope

- A `@branchout/game-brambles` engine plugin (the `GamePlugin` + pure `GameModule`), on the LIVE
  lifecycle (spec 0044): one continuous phase, a per-session sim loop that streams the shared sprint
  state and re-delivers the Guide's secret each tick.
- A bundled sample card bank (~200 cards, bloom + five thorns each) under `data/brambles/`, with a
  loader and a structural validator (spec 0041 pattern - structure only, no count gates).
- The auto-referee: prick detection (bloom / thorn / near-stem) and fuzzy guess matching.
- Deterministic team assignment (seat order) and a mapping from team scores to per-player standings
  (build kit item 16 - no engine team support).
- The web UI module (spec 0023): a shared Viewer (scoreboard, timer, public clue/guess log), a Remote
  (the Guide sees the secret and types clues/skips; teammates type guesses), and a host ConfigPanel.
- A brand mark (`@branchout/brand/brambles`), catalog + library entries, and registry wiring.
- Unit tests, web component tests, and a two-team e2e at 360px.

Out of scope: the full (large) card bank (would ship from the private data repo per spec 0041);
voice/verbal play (Brambles is online-typed); a challenge/steal mechanic for the opposing grove.

## Approach

**Lifecycle - LIVE (spec 0044).** The engine's turn-based `collectMove` does not re-broadcast state
after a successful move, and cannot emit a per-player `private` payload mid-round. Brambles needs
both: the Guide's typed clue must reach the guessing grove in real time, and a newly drawn card's
secret must reach the Guide mid-sprint. Only the live `tick` streams a `sim` frame AND re-delivers a
targeted `private` payload every frame (with reconnect catch-up). So Brambles implements `tick`:

- `configure` assigns the two groves by sorted player id (alternating), stores team membership and
  scores, and starts a live game (no move window).
- `startRound` opens the first sprint, draws the first card, and hands the bloom + thorns to the
  active Guide via `private: { [guideId]: {...} }`.
- `collectMove` applies a JSON move `{ kind: 'clue' | 'guess' | 'skip', text }` to shared scratch:
  the Guide's clue is auto-refereed (a prick burns the card and draws the next; a clean clue is
  logged); a teammate's guess is fuzzy-matched (a match scores the grove +1 and draws the next); a
  skip draws the next. Out-of-turn or wrong-role moves are rejected to that one device.
- `tick` advances the sprint clock (by tick count, so it freezes on pause), streams the `sim`
  snapshot (which NEVER carries the bloom or thorns), re-delivers the Guide's secret, and closes the
  sprint on the timer - handing off to the other grove, or ending the game after the final sprint.
- `endGame`/`leaderboard` map the two grove scores to per-player standings (all members share the
  grove's rank).

**Secrecy (spec 0052).** The bloom + thorns are placed ONLY in the `private` map keyed by the active
Guide's id; the engine targets each `private` frame to that player's device(s) and never broadcasts
it. The broadcast `sim` is asserted (in unit AND browser tests) to contain neither the bloom nor any
thorn. The web reducer additionally ignores a `private` frame addressed to a different player.

**Auto-referee.** Clue and word text are normalized (lowercase, accent-fold, punctuation-strip). A
prick fires when a clue token shares a crude stem with the bloom or a single-word thorn, or when a
multi-word thorn appears as a contiguous phrase. Guess matching is lenient (exact, shared stem, or a
small length-scaled edit distance) so a typo or plural still scores.

**Content bank.** ~200 cards across six categories (nature, everyday, action, places, food, people),
each a bloom plus exactly five thorns, loaded via `services.assets.forModule` and validated for
structure at boot.

## Acceptance

- Four+ players in two groves; `visibility: 'insider'` on the manifest and the web module; minimum
  four players enforced.
- The bloom + thorns reach ONLY the active Guide - proven by a unit test (the `private` map has
  exactly the Guide's id; the `sim` contains no secret) and a browser test (only the Guide's Remote
  shows the bloom; the Viewer never does).
- A teammate's fuzzy guess scores the grove and draws the next card; a clue containing the bloom or a
  thorn pricks the card (no point); the Guide may skip.
- The sprint timer closes the turn and hands off to the other grove; the game ends after all sprints
  and ranks the winning grove's members together at the top.
- The sample card bank loads and passes the structural validator; team assignment is deterministic.
- Green: typecheck, lint, unit + web tests, web build, prettier, ASCII-only; a two-team e2e at 360px
  drives a real sprint to a scored bloom and a final standing.
