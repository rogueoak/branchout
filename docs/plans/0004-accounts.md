# 0004 - Accounts and anonymous play (plan)

Source spec: `docs/specs/0004-accounts.md`.

## Approach

Extend the Fastify control-plane scaffold with an account model, a swappable password
hasher, a Redis-backed session store, and the auth endpoints. Add `/signup` and `/login`
pages to `apps/web`. No live DB in tests: repositories and the session store sit behind
interfaces with in-memory fakes.

## Control-plane modules (`apps/control-plane/src`)

- `accounts/hasher.ts` - `PasswordHasher` interface, argon2id implementation
  (`@node-rs/argon2`), bcrypt fallback (`bcryptjs`); `createHasher()` picks argon2id and
  degrades to bcrypt if the native module fails to load. `verify` dispatches on the hash
  prefix so both algorithms round-trip. One module, swappable.
- `accounts/gamertag.ts` - normalize (trim + lowercase) and validate (3-20 chars,
  `[a-z0-9_-]`). Uniqueness is enforced case-insensitively on the normalized value.
- `accounts/nickname.ts` - validate free-form display text (1-40 chars, no control chars).
- `accounts/repository.ts` - `AccountRepository` interface + Postgres implementation
  (parameterized queries). `InMemoryAccountRepository` for tests.
- `accounts/migrations.ts` - minimal migration runner: a `schema_migrations` ledger table
  plus ordered SQL statements applied on startup / via a `migrate` script.
- `accounts/service.ts` - `AccountService`: signup, login, changeNickname, getById. Owns
  validation, normalization, taken-check, hashing.
- `sessions/store.ts` - `SessionStore` interface (create/read/revoke, sliding expiry) +
  Redis implementation keyed by an opaque id. `InMemorySessionStore` for tests.
- `sessions/session.ts` - shared `Session` shape with `kind: 'account' | 'anonymous'` and
  `canHost(session)` authorization helper (only accounts host).
- `routes/auth.ts` - `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/me`,
  `/auth/nickname`, `/auth/anonymous` (join-by-code). Cookie helpers set/clear an
  httpOnly + secure + sameSite session cookie via `@fastify/cookie`.
- `app.ts` - `createApp(deps)` registers cookie plugin, health, and auth routes.
- `config.ts` / `index.ts` - add cookie + session settings, run migrations on boot, wire
  real Postgres/Redis implementations.

## Web (`apps/web/app`)

- `signup/page.tsx` + `login/page.tsx` - client forms that POST to the control-plane and
  render field/error states. Plain elements + the existing canopy button placeholder; no
  theme or global CSS touched.

## Tests

- hasher hash/verify (argon2id + bcrypt round-trip, wrong password fails)
- gamer-tag normalization + uniqueness
- session create/read/revoke + sliding expiry
- anonymous host-block (`canHost`)
- nickname change (valid + rejected)
- endpoints via Fastify `inject()`: signup, login, logout, me (account/anonymous/none),
  duplicate email/tag, anonymous join.
- web: signup + login pages render and surface errors.

## Decisions / follow-ups

- Email verification: `email_verified` column defaults false, unused for now. Follow-up spec.
- Sessions are server-side (Redis) with an opaque cookie id, revocable, sliding TTL.
- OAuth, password reset, profiles, friends, billing: out, owned by later specs.
