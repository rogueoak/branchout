# 0040 - Account deletion lifecycle

> Two deletion paths that share one schema change and the admin surface, so they ship together:
> a player **soft-deletes their own** account (self-service), and an admin **hard-deletes** any
> account (a purge). Builds on `0037` (the admin console + player service) and `0027` (the account
> page). Sequenced after `0039` (it also edits the account page + `account-api`).

## Problem

- A player has **no way to delete their own account**. The only account controls are nickname,
  avatar, and visibility (`0027`); there is no exit.
- An admin has **no way to remove an account** at all - the console can view players and toggle the
  insider role (`0037`), but a genuinely unwanted account (spam, abuse, a support request to purge)
  cannot be deleted.

These are different tools for different jobs. A player deleting themselves wants to be **gone from
the product** but the record should survive for support/audit and to keep the admin console honest;
an admin purging an account wants it **gone from the database**. So: self-service = soft delete;
admin = hard delete.

## Outcome

- **Self-service soft delete.** On `/account`, a "Danger zone" lets a player delete their account
  behind a confirm step. The account row is kept with `deleted_at` set; the player is logged out and
  cannot log back in. Per the deletion decision, the **email + gamer tag are freed for reuse**
  (the unique-constrained columns are tombstoned) so the same email/tag can register a fresh account;
  the original row stays visible in the admin console, flagged **Deleted**.
- **Admin hard delete.** On the admin user-detail page, a "Delete player" action (behind a confirm)
  purges the account: the `accounts` row is deleted and its own per-account game history
  (`account_game_plays`) cascades away. The **credit ledger is kept** (append-only audit). The
  player's sessions self-revoke on next use (the account row is gone). The user disappears from the
  admin list.
- A soft-deleted account **cannot authenticate**: login is refused and any lingering session is
  treated as logged out.

## Scope

In:

- **Migration** (`accounts/migrations.ts`, next id `8`): add a nullable `deleted_at timestamptz`
  column. Safe constant default (absent = live), per the versioned-envelope learning.
- **Repository** (`accounts/repository.ts` + `repository.memory.ts`): add `deletedAt: Date | null`
  to `Account`; a `findById` `includeDeleted` option; `softDelete(id)` (sets `deleted_at`, tombstones
  `email` -> `deleted-<id>@deleted.invalid` and `gamer_tag_normalized` -> `deleted-<id>`, keeps the
  display `gamer_tag`/`nickname`); `hardDelete(id)` (`DELETE FROM accounts WHERE id`).
- **Service** (`accounts/service.ts`): `deletedAt` on `PublicAccount`; `login()` and `getById()`
  refuse a soft-deleted row; a `getByIdForAdmin()` that returns it; `listPlayers()` exposes
  `deletedAt`; `softDeleteSelf(id)` and `hardDelete(id)`.
- **Routes**: `DELETE /auth/account` (account session required -> soft-delete self, revoke session,
  clear cookie) in `routes/auth.ts`; `POST /admin/users/:id/delete` (requireAdmin -> hard-delete) in
  `routes/admin.ts`; the admin user-detail route reads via `getByIdForAdmin`.
- **Web** (`apps/web`): `deleteAccount()` in `lib/account-api.ts`; a **Danger zone** on
  `AccountClient.tsx` with a two-step confirm; on success route home.
- **Admin** (`apps/admin`): `deleteUser()` in `lib/admin-api.ts`; a `DeleteUser` confirm component on
  the user-detail page; a **Deleted** badge on the list + detail when `deletedAt` is set.
- **Tests**: unit (service refuses deleted on login/getById; admin still sees it; softDelete
  tombstones; hardDelete removes), integration (`app.test.ts`: self-delete -> logged out + same email
  re-registers; admin hard delete -> row gone, ledger kept), e2e (account self-delete flow; admin
  hard delete + Deleted badge).

Out:

- **Purging hosted rooms** on hard delete. `room_games`/`room_rounds` reference `rooms(id)` with **no
  cascade** and hold the recorded history of **every** participant, not just the host - deleting a
  host's rooms would erase other players' game records (and hit FK violations). The dangling
  `host_account_id` is harmless (no FK) and rooms are transient, so hard delete leaves them. Only the
  account's own `account_game_plays` (which cascades) is removed.
- **Undelete / account recovery UI** - the soft-deleted row is recoverable by a manual DB update for
  now; a restore action is a later spec.
- **A grace period / scheduled purge** of soft-deleted rows - out of scope; they persist until an
  admin hard-deletes.
- **Deleting the credit ledger** - kept for audit by decision.

## Approach

- **Two doors, two semantics.** Self-service is reversible-by-support (soft); admin is a purge
  (hard). One `deleted_at` column serves both: soft sets it; the admin console reads it to flag
  deleted rows; hard delete removes the row entirely.
- **Free the identity on soft delete.** The unique keys (`email`, `gamer_tag_normalized`) are
  tombstoned so a departing player can start over with the same email/tag, while the display
  `gamer_tag`/`nickname` are preserved so the admin console still shows who the row was.
- **Deleted means gone to the product, not to the operator.** `login`/`getById` refuse a soft-deleted
  account (the existing `/auth/me` self-revoke logs stale sessions out); a separate admin read path
  keeps it visible.
- **Sessions self-heal.** Neither path scans Redis: once the row is soft-deleted (getById refuses) or
  hard-deleted (row gone), the next `/auth/me` self-revokes the session - the mechanism `0037`
  already proves.
- **Confirm before an irreversible-feeling action.** Both UIs gate the action behind an explicit
  confirm step - mobile-first, no accidental taps.

## Acceptance

- [ ] `accounts` has a nullable `deleted_at`; the migration applies cleanly on an existing DB.
- [ ] `DELETE /auth/account` soft-deletes the caller, revokes the session, clears the cookie; a
      second call / a signed-out call is handled gracefully.
- [ ] A soft-deleted account cannot log in, and its email + gamer tag can be registered again.
- [ ] `POST /admin/users/:id/delete` (admin only) hard-deletes: the row and `account_game_plays` are
      gone, the credit ledger rows remain, and the user leaves the admin list. A non-admin call is 401.
- [ ] The admin list + detail flag a soft-deleted account as **Deleted**; the detail page still loads
      via `getByIdForAdmin`.
- [ ] The account page "Danger zone" deletes behind a confirm and is usable at 360px.
- [ ] Unit + integration + e2e cover the self-delete and admin-delete flows and pass in CI.
