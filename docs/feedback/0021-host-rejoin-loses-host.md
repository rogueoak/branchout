# 0021 - A returning host is bounced to the join screen and loses host

## Report

> When I am a host and come back to a room after a stretch of time, I get prompted to join a
> room and I'm no longer the host. I would expect it to keep me as the host on rejoin.

## Root cause

Host status has two representations that expire independently, and the return path only reads the
ephemeral one:

- **Durable (Postgres `rooms.host_account_id`)** - the room belongs to the host's account forever.
- **Ephemeral (Redis `room:<id>:members`, 12h TTL)** - the presence/roster hash, `isHost` per row.
- **Client (`sessionStorage`, per-tab)** - `apps/web/lib/membership.ts` remembers the caller's row
  for this tab only; `sessionStorage` is cleared when the tab/browser is closed.

Two things go wrong when a host returns after being away:

1. **Client forgets first.** `RoomClient` hydrates membership from `sessionStorage`
   (`recallMembership`). If the tab was closed, that is gone, so `membership` is `null` and the page
   renders the "Join room {code}" prompt immediately - *without ever asking the server whether this
   account already owns the room*.
2. **Server gate is Redis-only.** Even with the tab open past the 12h TTL, `RoomService.view()` and
   `members()` gate on `membership.get(...)` and throw `forbidden` when the Redis row has expired -
   although `host_account_id` in Postgres still names this account as the host.

`join()` already re-derives `isHost` from Postgres correctly, so a host who clicks through the join
form does get host back - but the seamless "drop me back in my room" experience is lost, which is
what the report is about.

## Fix

Recover the caller's seat from the durable record instead of trusting only the ephemeral one.

- **Control-plane**
  - `RoomService.resolveCaller(room, session)` - returns the live Redis membership if present;
    otherwise **re-seats the durable host** (the account matching `host_account_id`) as a full
    player with host powers and returns it; otherwise `null`. `view()` and `members()` use it, so a
    host past the Redis TTL is silently re-seated instead of 403'd.
  - New `RoomService.resume(code, session)` + `GET /rooms/:code/me`: returns the caller's own
    membership row (re-seating the durable host if needed), or a new `not_member` error (404) when
    the caller genuinely is not in the room. This lets the client ask "who am I here?" on load.
  - New `RoomError` code `not_member` (404) - distinct from `forbidden`, so the client shows the
    join prompt only for a true non-member, not for a transient/network error.
- **Web**
  - `resumeRoom(code)` in `room-api.ts`.
  - `RoomClient`: when `sessionStorage` has no membership, **try `resumeRoom` before falling back to
    the join prompt**. A durable host (or any still-live member whose session cookie survived) is
    dropped straight back into the room; only a true non-member sees "Join room".

A returning member who is still live in Redis is also recovered as a side effect - a strict
improvement, not just the host.

### Known limitation

If the host returns *while a game is still running* after their roster row had fully expired, the
re-seat mints a fresh `playerId` (same behaviour the existing `join()`-after-expiry path already
has), so their in-engine play identity is new. Host controls still work (they authorize off the
account, not the `playerId`). Reconciling the engine roster across a full expiry is out of scope.

## Tests

- Unit (`rooms/service.test.ts`): `view`/`members` re-seat the durable host when the Redis row is
  gone; `resume` returns the host row after expiry and throws `not_member` for a non-member;
  a non-host with no row is not re-seated.
- Integration (`app.test.ts`): host creates a room, membership is dropped from the store (simulating
  TTL expiry), `GET /rooms/:code/me` returns the host row and re-seats them; a stranger gets 404.
- e2e (`e2e/tests/host-rejoin.spec.ts`): host creates a room, we clear the tab's `sessionStorage`
  and reload, and the host lands back in the lobby with host controls - no join prompt.
