# 0015 - Trivia play polish

Three play-feel tweaks surfaced by playtesting the end-to-end game (feedback `0014`). They are
independent of the difficulty-model rework (folded into spec `0008`) and ship first as one small PR.

## Symptom

1. **The answer round never closes on its own.** Once every player has answered, the round still
   sits in `collecting` until the host taps Next - dead air with nothing left to do.
2. **Revealed answers look shouty/wrong.** The bank stores answers all-lowercase (the matcher
   normalizes to lowercase), so the viewer showed `the beatles` / `carbon dioxide` verbatim - no
   capitals on proper nouns.
3. **A solo game still offers Dispute.** A single-player game shows the Dispute button, but a
   dispute goes to a vote of the *other* players - with none, the engine can never uphold it, so
   the button is a dead end.

## Root cause

1. The engine only leaves `collecting` on a host `advance` (or the dispute-window timer, which
   arms *after* collecting). There is no "everyone answered" signal, so nothing auto-closes the
   answer round.
2. Display reused the stored answer string directly. Storage is lowercase by contract (the
   validator enforces it and the matcher lowercases both sides), so the display had no capitals to
   show.
3. The Dispute button rendered whenever the local player was marked wrong, regardless of whether
   any other connected player existed to vote.

## Fix

1. `collectAnswer` reports `allAnswered` (every *connected* player has submitted this round); the
   engine schedules a 2s timer that advances `collecting -> reveal`, re-checking phase/round/pause
   at fire time. The host can still advance immediately.
2. A display-only title-case helper (`apps/web/lib/title-case.ts`) caps significant words for the
   reveal; the stored value and the lowercase comparison are untouched. Best-effort: acronyms and
   stylized forms (`CO2`, `iPhone`) cannot be recovered from lowercase - the dispute vote remains
   the human fallback.
3. The remote hides the Dispute button unless at least one *other connected* player is present -
   the same population the dispute vote needs.

## Review refinements (PR #25 personas)

- **Engineer (major):** auto-advance was armed only on `submitAnswer`, so a round hung when the
  last silent player *dropped* instead of answering. Fixed: the engine also re-checks and arms on
  `disconnect` while `collecting`. `allAnswered` moved off `ScratchResult` to a `GameModule`
  method so both paths can ask it. Added a `runId` guard to the fire-time check so a restart's
  reused round number cannot fire a stale timer.
- **Tester (minor):** added the host-advances-before-grace stale-timer no-op test and split the
  disconnect coverage so the "silent player drops -> auto-advances without a resubmit" partition is
  asserted directly.
- **User (Player) (minor):** a solo marked-wrong player now gets honest closed copy instead of a
  dangling "may go to a vote"; a `STYLIZED` allowlist fixes common acronym/brand casing (`CO2`,
  `NASA`, `iPhone`) that plain title-casing mangled.

Deferred (tracked as follow-ups, non-blocking):
- **User (Player):** the auto-advance transition is silent on the remote; a "everyone answered -
  revealing..." cue needs a wire signal (a `state`-frame flag), out of scope for this polish PR.
- **Architect:** the engine could also no-op a voterless dispute (defense in depth); today the
  client gate prevents it and `disputeVote` already cannot uphold one with zero connected voters.

## Learning

- **A phase that can end by consensus needs a consensus signal, not just a host tap or a timer.**
  The engine owned "advance on host/timer" but not "advance when everyone is done"; a party game
  where the table has clearly finished should not wait on a manual tap. When a phase has a natural
  completion condition the players can satisfy, give the engine a way to observe it and close the
  phase (here: `allAnswered` -> a short grace timer -> auto-advance).
- **Store the canonical form, present a display form; never make storage carry presentation.** The
  answer bank is lowercase because matching is case-insensitive; the fix for ugly display is a
  presentation transform at the view, not a data change. A control that only makes sense with other
  participants (Dispute) gates on the live participant count, computed from the roster the client
  already holds - not assumed present.
