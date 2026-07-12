# 0020 - Rate-limit key must anchor on an unforgeable dimension (spec 0036)

Captured from the persona review of PR #58 (spec 0036). Two security issues in the first cut of the
auth rate limiter.

## Symptom

1. **The login lockout was bypassable.** The key was `login:<email>:<ip>`. `request.ip` comes from
   `X-Forwarded-For`, which Caddy *appends* to (it does not strip a client-supplied value), so an
   attacker controls it and rotates it per request - minting a fresh `(account, ip)` bucket every time
   and brute-forcing a targeted account without ever tripping the lock. The "account is the
   spoof-resistant anchor" claim was false *because the key still included the IP*.
2. **A counter could get permanently stuck.** `record` did `INCR` then set the window with `EXPIRE`
   only when the count was 1. If the process died between the two, the key was left with no TTL and
   never repaired (later calls skipped the `expire` branch and `check` runs before `record`, so a
   blocked caller never reached code that could re-arm it) - a permanent lockout of a real user and an
   unbounded Redis key.

## Root cause

The key mixed an unforgeable dimension (the account) with a forgeable one (the client IP behind an
append-only XFF), which reduces the whole key to the forgeable part - rotating the IP rotates the key.
And a fixed window built from two non-atomic Redis ops (`INCR` + `EXPIRE`) has a failure seam that
leaves a live counter with no expiry.

## Fix

- Anchor the login lockout on `login:<email>` alone - the caller cannot change which account they are
  attacking, so the counter is not evadable. Documented the accepted tradeoff (account-lockout can be
  used to briefly lock a target; bounded by the short window; CAPTCHA / progressive delay is a future
  softener). The per-IP signup cap stays but is documented as best-effort.
- `check` self-heals: a counter at/over the limit with `ttl < 0` (no expiry) is an anomaly, so it is
  deleted and the actor starts a fresh window rather than being locked forever. Guarded the count parse
  against `NaN`. Added a fake-Redis contract test that exercises exactly this path.

## Learning

A rate-limit / lockout key must anchor on the dimension the actor **cannot control**. A client IP
derived from `X-Forwarded-For` is forgeable whenever the edge appends rather than strips it, so it can
only ever be a best-effort *secondary* signal - never the sole key of a security lockout. And a
fixed-window counter assembled from separate `INCR` + `EXPIRE` calls must be able to **recover a lost
TTL**, or an ordinary crash becomes a permanent lockout. Generalized into `overview/learnings.md`.
