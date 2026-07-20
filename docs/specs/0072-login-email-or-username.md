# 0072 - Log in with email or username

## Problem

Today a player logs in with their **email + password**. Their public identity everywhere else in the
product is their **gamer tag** (username), so on the login screen they must recall a different
credential than the one they see on their profile, in rooms, and on the leaderboard. The operator
wants a single identifier field that accepts **either the email or the gamer tag** with the password.

## Outcome

- The login form has one identifier field labelled "Email or username" that accepts a plain string
  (an email or a gamer tag), plus the password field.
- Submitting the gamer tag + correct password logs the player in, exactly as the email + password
  does today.
- A wrong password, or an identifier that matches no account, returns the same generic
  "invalid credentials" 401 - the direct response never reveals whether the identifier existed or which
  field was wrong, and carries the same timing posture as today (a miss still runs a hash verify).
- The per-account login lockout (spec 0036) counts an email attempt and a username attempt against
  the **same** account bucket, so an attacker cannot double their allowance (or dodge the lock) by
  alternating identifier forms.
- A secondary per-IP cap on failed logins bounds how many different victims one source can lock out
  (username login makes the lockout trigger a public identifier - see Security).
- Signup is unchanged: still email + password + gamer tag.

## Scope

**In**

- Control-plane `POST /v1/auth/login`: resolve the account by email (identifier contains `@`) or by
  gamer tag (otherwise), verify the password identically, and key the lockout on the resolved account.
- The login request body field renames from `email` to `identifier`.
- Web `/login`: the identifier field (label, `type=text`, `autocomplete=username`, no client-side
  email-format rejection), the request body, and the copy.
- Tests: control-plane unit + route, web form, and an e2e that logs in by username and by email.

**Out**

- Signup (unchanged).
- Admin login (`/admin/auth/login`) - a separate credential path, untouched.
- Password reset, email verification, or any new identity field.

## Approach

- **Resolve then key.** `AccountService.beginLogin(identifier)` resolves the identifier to an account
  and returns `{ lockKey, verify(password) }`. An identifier containing `@` is looked up by email;
  otherwise by normalized gamer tag (the two charsets are disjoint - a gamer tag is `[a-z0-9_-]`, an
  email must contain `@` - so the branch is unambiguous). The lockout `lockKey` is the resolved
  **account id** when it matches, else a normalized form of the raw identifier (its own bounded
  bucket). Keying on the account id is what makes an email attempt and a username attempt on the same
  account share one lockout bucket.
- **Low direct enumeration signal.** `verify` runs a hash comparison even on a miss (against a cached
  throwaway hash), and the route returns an identical generic 401 whether or not the identifier matched
  - the same constant-time posture the email-only path had. The lockout key is server-side only and
  never echoed to the client. This is not *zero* oracle (see Security: the shared lockout bucket is a
  low-severity cross-form correlation channel), but the direct response reveals nothing.
- **Preserve the lockout ordering, add a per-IP dimension.** The route checks the per-IP failed-login
  cap, resolves the identifier (to get the account-anchored lock key), checks the per-account limiter,
  verifies the password, and records a failure (against both the account and the IP) or resets the
  account counter on success - the same check/verify/record/reset order as spec 0036, keyed on the
  resolved account, now with the extra per-IP bucket. The per-IP bucket does not reset on success.
- **Web.** The field is `type=text` with `autoComplete="username"` so a browser offers the saved
  username, and the page drops any email-format assumption (the input was `type=email`).

## Security

Two accepted, documented trade-offs and one mitigation:

- **The lockout trigger is now a public identifier (account-lockout DoS surface widened).** Before this
  change, locking a victim's account required knowing their (semi-private) email; now their **public
  gamer tag** resolves to the same `login:account:<id>` bucket, so anyone can lock a victim out by
  hammering failed logins against their handle. This is a real widening, not "the standard tradeoff".
  **Mitigation (in this spec):** a secondary per-IP cap on failed logins (`loginMaxPerIp`, default 30 /
  15 min, generous so a shared NAT/CGNAT is not caught) bounds how many handles one source can lock per
  window. It is a secondary signal, meaningful only where the IP is trustworthy (edge sanitizes
  X-Forwarded-For, spec 0038), and does not fully close the DoS - a determined attacker with many IPs
  can still lock a few handles per window. **Tracked follow-up (not built here, deliberately not
  overbuilt):** a progressive-delay or CAPTCHA step on repeated failures would close the residual gap;
  out of scope for this spec.
- **The shared lockout bucket is a low-severity cross-form correlation oracle.** Because an email
  attempt and a username attempt on the same account share one bucket, an attacker who locks an account
  via a **known email**, then sees a `429` on a **guessed username**, has confirmed that the email and
  the public handle belong to the same account - linking a private email to a public identity. This is
  inherent to (and the point of) keying the lock on the resolved account: not doing so would reopen the
  lock-bypass. It is low severity (it correlates two identifiers the attacker already holds; it does not
  disclose either), and we accept it as the cost of a bypass-proof lock.

## Acceptance

- [ ] Login by email + correct password succeeds (unchanged).
- [ ] Login by gamer tag + correct password succeeds.
- [ ] A wrong password returns the same generic 401 for both email and username identifiers.
- [ ] An identifier that matches no account returns the same generic 401 (no field leak).
- [ ] The lockout counts email attempts and username attempts against the SAME account bucket: after
      the limit is reached via one form, the other form is also locked (429).
- [ ] A single source IP is capped after `loginMaxPerIp` failed logins across different handles (429),
      while another IP is unaffected, and a successful login does not consume the per-IP budget.
- [ ] The web form accepts a username (no email-format rejection), posts `{ identifier, password }`,
      and the field is labelled "Email or username".
- [ ] An e2e logs a signed-up account in through the real `/login` UI by username and by email.
- [ ] Tests, lint, build, and `pnpm format:check` pass.
