# 0004 - Rooms security review (spec 0006)

## Symptom

The Spectra security persona reviewed the rooms + credit-gating PR (spec 0006) and found six
issues (3 major, 3 minor) in the money and roster surfaces.

## Root cause and fix

Fixed in this PR:

- **Silent credit loss on retry (major).** The round debit was gated behind `recorded`, so a
  crash between recording the round and debiting left the round billed zero forever - a retried
  report saw the duplicate and skipped the debit. Fix: debit unconditionally (the ledger is
  idempotent by `roundId`), so a retry both bills exactly once and heals a failed debit.
- **Timing oracle on the internal token (major).** The engine-report guard compared the bearer
  secret with `!==` (short-circuiting, non-constant-time). Fix: `crypto.timingSafeEqual` over
  equal-length buffers, with an early length-mismatch reject and array-header handling.
- **Roster / sessionId leak (minor).** `GET /rooms/:code/members` required only *a* session, so
  anyone who knew a 5-character code could enumerate members - including each `sessionId`, the
  kick target and rejoin key. Fix: require the caller to be a member, and return `sessionId` only
  to the host.
- **Open money endpoint when the token is unset (minor).** An unset `internalToken` left the
  debit/star endpoints fully open. Fix: fail closed in production - reject unless
  `ALLOW_UNAUTHENTICATED_ENGINE=1` is explicitly set; open only in dev.

Explicitly deferred (decided, not silent):

- **Overdraft across concurrent games (major).** Affordability is checked at start but nothing is
  reserved, and `debitRound` has no floor; a host running several rooms at once can drive the
  ledger negative. Spec 0006 scopes single-game credit reservation out, so this is deferred to the
  Purchases/reservation spec (a hold-at-start reservation and/or a one-running-game-per-host cap).
  Noted in code at the `start` affordability check.
- **Kick "disconnected" is partial here (minor).** `kick` removes the member from Redis and bars a
  same-session rejoin, but the live game stream is engine-side, so the actual transport disconnect
  belongs to the engine/realtime layer. Revoking the whole session would log the user out
  everywhere (wrong for a per-room kick). Tracked to the engine spec.

## Learning

Fail closed on an unset secret in production, and never let a dedupe key stand in for a
transaction - both generalize past this change (see `overview/learnings.md`).
