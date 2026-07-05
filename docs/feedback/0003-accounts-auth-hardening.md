# 0003 - Auth hardening from the 0004 persona review

## Symptom

The first cut of the accounts service (spec `0004`) passed tests and worked, but the Spectra
persona review (security, engineer, architect, tester) surfaced a cluster of auth-hardening and
boundary gaps that would have shipped otherwise:

- **Login timing oracle** - login returned early on an unknown email, skipping the password
  verify, so response latency revealed whether an email was registered.
- **bcrypt truncation** - the bcrypt fallback silently ignored input past 72 bytes while the
  password max was 200, so a long passphrase lost strength (and differed from the argon2 path).
- **Boot continued on migration failure** - a failed migration was logged but the server still
  listened, serving 500s against a missing schema while `/health` reported Postgres "ok".
- **Wrong-direction module deps** - the generic migration runner lived under `accounts/`, and the
  anonymous session flow imported its display-name validator from `accounts/`, coupling sessions
  and future domains to accounts.
- **Misleading over-length password message** and a dead `gamerTagKey` export.
- **Untested failure partitions** - the create-time duplicate race, logout with no cookie, and
  the `/auth/me` stale-account self-revoke had no tests.

## Root cause

The happy path and the "reject taken email/tag" rules were built first; the adversarial and
degraded branches (timing, truncation, fail-fast, self-revoke) were implicit. Module placement
followed "where I was working" (accounts) rather than "who owns this concern" (db, shared
validation).

## Fix

- Login now always runs a verify - against a cached dummy hash when no account is found - so both
  paths cost the same.
- The bcrypt fallback pre-hashes with SHA-256 so the whole password contributes; a >72-byte test
  proves no truncation.
- Migration failure rethrows and aborts boot.
- The migration runner moved to `db/migrations.ts` (generic) with per-domain entries assembled at
  a `migrations.ts` composition root; display-name validation moved to a neutral
  `validation/display-name.ts` that both accounts and sessions depend on.
- Over-length password gets its own message; `gamerTagKey` removed; `sameSite` is now
  env-driven (`COOKIE_SAMESITE`) for cross-site deploys.
- Added tests for the race branch, no-cookie logout, stale-account `/auth/me`, the password
  upper bound, and cookie-policy parsing.

## Accepted trade-offs (tracked, not fixed here)

- **Signup existence oracle** - the spec mandates rejecting a taken email/tag with a clear
  message, which reveals that an email exists. Kept for signup UX; revisit alongside email
  verification.
- **No rate limiting** on `/auth/login` and `/auth/signup` - out of scope for `0004`; a
  follow-up should add per-IP throttling (`@fastify/rate-limit`) to blunt credential-stuffing and
  the unauthenticated-signup hashing-DoS surface.

## Learning

Generalizes past this feature - see `overview/learnings.md`: build the failure and adversarial
partitions with the happy path (constant-time auth, no silent truncation, fail-fast on
un-healable state), and place a module by the concern it owns, not the file you happen to be in.
