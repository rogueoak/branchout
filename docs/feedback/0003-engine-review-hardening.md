# 0003 - Engine review hardening (spec 0007)

## Symptom

Spectra persona review of the `0007` engine PR surfaced several must-fix gaps in the first cut,
across boundaries, security, and reporting:

- **Session lifecycle wedge (architect, major).** A finished game left a `complete` session blob
  in Redis forever, so the `start` idempotency check kept returning `running` - `0006` could
  never re-hand-off the same game into a room, and dead sessions accumulated.
- **Internal state leak (architect, major).** The inspect route returned the raw `SessionState`
  (module `scratch`, opaque `config`) to any caller, which for Trivia (`0008`) would leak the
  round's answers mid-round.
- **Player impersonation (security, major).** `join` auto-created any client-supplied `player` id
  or took over a handed-off slot, so a client that knew a live room+game could inject or
  impersonate a player and submit answers/votes as them.
- **Reporting not actually retried (engineer/tester, major/minor).** A round report dropped while
  the control-plane was down was lost forever; the "retries on the next finalize" comment
  overclaimed, and the idempotency test never proved a failed report is later delivered exactly
  once.
- **Smaller:** a dead `revealing` phase in the contract; a paused dispute-window timer that
  stranded the round on resume; identity fields validated only as non-empty strings while being
  concatenated into channel names and idempotency keys (`:` injection); missing tests for the
  real HTTP reporter and the socket authorization guards; an unbounded per-session lock map.

## Root cause

The first implementation optimized the happy path and deferred the boundary and failure-mode
details: it treated `complete` as terminal-and-forgotten rather than a startable state, exposed
an internal type on a public route for convenience, trusted client-supplied identity on join,
and modeled report "idempotency" as dedupe-only without an outbox, so failure meant loss.

## Fix

- `start` treats a `complete` session as startable; the Redis store sets a TTL on completed
  sessions so they self-clean.
- The inspect route returns the protocol `state` projection (`getSnapshot`), never `scratch` or
  `config`.
- `join` requires the player to be in the handed-off roster (`UnknownPlayerError`); the socket
  already blocked acting as another player once bound.
- A per-session **outbox** (`pendingRounds`) retries failed round reports on the next
  finalize/endGame; the `roundId` dedupe still guarantees at most one debit. Comment corrected.
- Dropped the `revealing` phase from the contract; re-arm the dispute window on resume; added a
  `requireId` charset+length validator for room/game/player/target; added tests for the HTTP
  reporter, the socket guards, the outbox retry, completed-session restart, and pause re-arm;
  prune the lock map when a session's chain drains.

## Learning

Two lessons generalize past this feature and belong in `overview/learnings.md`:

- Model an ephemeral session's **end state as reusable, not terminal-and-forgotten** - give it a
  TTL and let the entry point restart over it, or the "already exists" guard wedges re-entry.
- **At-least-once reporting needs an outbox, not just a dedupe key** - a stable id makes a retry
  safe, but something has to actually retry; dedupe alone turns a transient failure into silent
  loss.
