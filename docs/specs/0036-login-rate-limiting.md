# 0036 - Login rate limiting (sign-in + sign-up)

> Second spec of the `0035`-`0037` group, but **independent** - it touches only `control-plane` auth and
> can ship in its own PR before or after `0035`. It builds a **reusable** Redis-backed limiter that
> `0037` reuses for the admin login. No Caddy or `web` changes.

## Problem

`POST /v1/auth/login` and `POST /v1/auth/signup` have no rate limiting, so nothing slows credential
stuffing / brute force against sign-in, or mass automated account creation against sign-up. This matters
more as we add findable surfaces: `0037` puts an admin login on `admin.branchout.games`, a hostname
anyone can discover via certificate-transparency logs, so the auth endpoints must resist being hammered.
We already run Redis (sessions live there), so the state a real limiter needs is already available.

## Outcome

- Repeated failed sign-ins are throttled and then temporarily locked out, keyed by **both** the account
  identifier and the client IP, so a single account or a single source cannot be ground indefinitely.
- Sign-up is capped per client IP per window, deterring mass automated account creation.
- A throttled caller gets a clear **429** with `Retry-After`; responses do **not** reveal whether an
  account exists (uniform messaging - no user enumeration via timing or wording).
- Limits reset on success (a legitimate user who logs in is not punished for earlier typos) and expire on
  their own via Redis TTL.
- Thresholds are configurable via env with safe defaults; the limiter is a **reusable** unit `0037`
  applies to the admin login.
- The behavior is covered by automated tests that prove lockout triggers and clears.

## Scope

In:

- A **reusable rate-limit / lockout utility** in `control-plane`, backed by the existing Redis (sliding
  window + temporary lockout; keys namespaced and TTL'd). Prefer a well-maintained library
  (`@fastify/rate-limit` with its Redis store) over hand-rolled counters where it fits; wrap it so the
  keying (IP + identifier) and the lockout policy are ours and reusable.
- Apply it to:
  - **`POST /v1/auth/login`** - count failures per `(account-identifier, IP)`; after N failures in the
    window, lock that pair for a cooldown; **reset on success**.
  - **`POST /v1/auth/signup`** - cap creations per IP per window.
- **429 + `Retry-After`** on limit, with **uniform, non-enumerating** responses (a locked-out login and
  a wrong password are indistinguishable to the caller).
- **Config** via env (`requireEnv`/config) for the window, threshold, and cooldown, with sane defaults
  documented.
- **Tests**: unit tests for the limiter (window, lockout, reset, TTL) and an integration test asserting
  the Nth+1 attempt returns 429 and that a later success is allowed once the window clears. Cover the
  in-memory store variant so the suite runs without Redis (mirrors the existing session-store test split).
- **`overview/architecture.md`** note: auth endpoints are rate-limited/lockable, the keying, and the
  configurable thresholds.

Out:

- **The admin login itself** - defined in `0037`, which reuses this limiter (this spec ships against the
  existing player auth endpoints).
- **MFA, CAPTCHA, or IP reputation / WAF** - out; rate limiting is the v1 control. (MFA remains a noted
  future hardening for admin.)
- **Edge/Caddy rate limiting** - not added here; the app layer is the right place for account-aware
  lockout (a custom Caddy build is a separate, optional defense-in-depth call).
- **Global request rate limiting** across all routes - scope is the auth endpoints.

## Approach

- **App layer, keyed on the account, backed by Redis.** IP-only edge throttling barely dents distributed
  credential stuffing and harms users behind shared NAT; a limiter that keys on `(account, IP)` and locks
  the pair is what actually stops brute force, and Redis gives it shared, restart-surviving,
  rollout-surviving state we already operate.
- **Fail closed but quiet.** Over the limit returns 429 with `Retry-After`, and every auth response stays
  uniform so the limiter never becomes an account-enumeration oracle. Success clears the counter so
  honest users are unaffected.
- **Reusable by construction.** The admin login in `0037` has the same shape (a findable, sensitive login
  on Redis); building the limiter as a wrappable unit here means `0037` just applies it.
- **Prove it with tests at the layer it lives.** Lockout is an API behavior, so unit + integration tests
  (Nth+1 -> 429, reset after window) are the automatable proof; no browser flow is required for this spec.

## Acceptance

- [ ] A reusable Redis-backed rate-limit/lockout utility exists in `control-plane`, with an in-memory
      variant for tests.
- [ ] `POST /v1/auth/login` locks out after N failed attempts per `(account, IP)` within the window and
      resets the counter on a successful login.
- [ ] `POST /v1/auth/signup` is capped per IP per window.
- [ ] Over-limit responses are 429 with `Retry-After` and are non-enumerating (indistinguishable from a
      normal auth failure).
- [ ] Window / threshold / cooldown are env-configurable with documented defaults.
- [ ] Unit + integration tests prove lockout triggers, stays uniform, and clears after the window; the
      suite passes without a live Redis.
- [ ] `overview/architecture.md` documents the auth rate-limiting/lockout, its keying, and the thresholds.
</content>
