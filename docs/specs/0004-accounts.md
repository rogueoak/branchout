# 0004 - Accounts and anonymous play

## Problem

Branch out needs identity before anything social or paid can work. A host must be a known
account so rooms, credits, and stars have an owner, and a friend handed a room code must be able
to jump in without signing up. Nothing in the scaffold provides sign-up, sessions, or the
anonymous path.

This is the first control-plane spec and the dependency for `0005`'s sign-up CTA and every host
action in `0006`.

## Outcome

- A visitor can sign up with an email and password, log in, log out, and read their own identity
  from a "me" endpoint.
- Every account has a unique **gamer tag** (always public) and a **nickname** that defaults to
  the gamer tag.
- A player can join a room by code with a chosen display name and get an ephemeral anonymous
  session, no account required. A host is always a signed-in account.

## Scope

In:
- **Account model** in Postgres: email (unique), a hashed password, gamer tag (unique, public),
  nickname (defaults to the gamer tag), timestamps. Never store the raw password.
- **Sign up** - email + password + desired gamer tag; validate the email shape, enforce a
  password minimum, reject a taken email or gamer tag, hash the password (argon2 or bcrypt), set
  the nickname to the gamer tag, and open a session.
- **Log in** - verify email + password against the hash, open a session.
- **Log out** - end the session and clear the cookie.
- **Me** - return the current identity (account id, gamer tag, nickname) for a signed-in account,
  or the ephemeral identity for an anonymous session, or unauthenticated.
- **Anonymous play** - a join-by-code path mints an ephemeral session with a chosen display name
  and no account row. It carries a session id and display name only; it cannot host.
- **Sessions** - an httpOnly, secure, sameSite cookie backed by a Redis-stored server session
  (see Approach for the trade-off). Anonymous and account sessions share the same cookie shape so
  downstream code reads one session.

Out (later specs own these):
- OAuth and social login. Email verification (stub the field or gate it behind a flag; note it as
  a follow-up). Password reset. Full profiles - avatar picker, privacy, online/player status,
  timeline, the stars badge - are the **Profiles** spec; this spec references it and stops at auth
  plus identity. Friends. Any billing or credit logic (`0006`).

## Approach

- **Session strategy** - use a **Redis-backed server session** keyed by an opaque session id in
  the cookie, not a self-contained JWT. Trade-off: a server session costs one Redis read per
  request but you can revoke it instantly (log out, ban, force logout) and keep the cookie tiny;
  a JWT saves the read but is hard to revoke before expiry and tempts you to pack identity into a
  token that can go stale. Branch out already runs Redis for room and game state (`0006`/`0007`),
  so the session store is free infrastructure. Set a sliding expiry.
- **Anonymous sessions** live only in Redis with a short TTL and no Postgres row - they are
  throwaway by design. The shared session shape carries a `kind` (`account` or `anonymous`) so a
  host-only check is one field read.
- **Password hashing** - argon2id if available, else bcrypt with a sane cost. Hashing and
  verification stay in one module so the algorithm is swappable.
- **Gamer tag** - unique, case-insensitive, a small allowed character set; validate and normalize
  on sign-up. The nickname is free-form display text and starts equal to the gamer tag.

## Acceptance

- [ ] Sign up creates a Postgres account with a hashed password (never plaintext), a unique gamer
      tag, and a nickname defaulting to the gamer tag; duplicate email or gamer tag is rejected.
- [ ] Log in verifies against the hash and opens a session; a wrong password fails without
      leaking which field was wrong.
- [ ] Log out ends the Redis session and clears the httpOnly cookie.
- [ ] "Me" returns the identity for an account session, the display name for an anonymous
      session, and unauthenticated when there is no session.
- [ ] Join-by-code mints an anonymous Redis session with a chosen display name and no account
      row; an anonymous session cannot host.
- [ ] The cookie is httpOnly, secure, and sameSite; email verification is stubbed or flagged and
      noted as a follow-up; profiles/friends/OAuth are out and referenced to their specs.
- [ ] Unit tests cover hashing/verification, gamer-tag uniqueness and normalization, session
      create/read/revoke, and the anonymous host-block.
