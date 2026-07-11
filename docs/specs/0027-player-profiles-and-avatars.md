# 0027 - Player profiles and avatars

## Problem

An account today is `{ id, gamerTag, nickname }` (spec `0004`). There is no avatar, no privacy
setting, and no public identity surface. The roadmap (`overview/features.md`) already calls for a
public profile - gamer tag (always public), nickname, an avatar from a set of cartoon characters, a
stars badge, and a recent-plays timeline - plus a privacy control (public / friends-only / private).
The upcoming top nav (spec `0028`) wants to show the signed-in player's **avatar** with a menu into
**manage account**, so an avatar and a place to manage it must exist first. This spec is the
foundation the nav and every "who is this player" surface builds on.

A second gap blocks the profile's stars/plays: `room_games.stars` is stored keyed by the ephemeral
`playerId`/nickname, **not** by `accountId`, so there is no way to total a player's stars or list
their recent games. We add per-account play history here so the profile has real data.

## Outcome

- An account has an **avatar** chosen from a fixed set of on-theme cartoon characters, a **nickname**
  (already exists; defaults to the gamer tag), and a **profile visibility** of `public` /
  `friends-only` / `private`. Gamer tag and stars stay public regardless of visibility.
- A new account is seeded a **deterministic default avatar** (from the gamer tag) so it always has
  one; the player can change it.
- A **public profile page** (`/u/[gamerTag]`) shows the gamer tag, nickname, avatar, **total stars**
  badge, and a **recent-plays timeline** (game, placement, stars, when) - gated by the owner's
  visibility (a `private` profile shows only the always-public gamer tag + stars; `friends-only`
  behaves as private to non-friends until friends ship, and says so).
- A signed-in player has an **account page** (`/account`) to edit nickname, pick an avatar, set
  visibility, view their own profile, and **log out** - the destination the nav's "manage account"
  menu points at.
- Completed games record **per-account** results so stars and recent plays are real, not stubbed.
- Covered by tests including the visibility partitions and the profile render, per the
  non-negotiables.

> All endpoints below live under the **`/v1`** prefix (spec `0033`, which builds first): e.g.
> `PATCH /v1/auth/avatar`, `GET /v1/profiles/:gamerTag`. Paths are written bare here for readability.

## Scope

In:

- **Avatar art** - a fixed set (~12) of cartoon-character avatars as SVG source in `assets/`,
  exported from `packages/brand` as strings (the "marks are code" pattern from specs `0003`/`0025`),
  each on-theme (Confetti palette). A deterministic `defaultAvatarFor(gamerTag)` picker.
- **control-plane**:
  - Migration: add `avatar` and `profile_visibility` to the accounts table (both defaulted so
    existing rows stay valid - see the versioned-envelope learning). Never edit a shipped migration.
  - Migration + write path: an **`account_game_plays`** record per account member of a completed
    game (account id, game id, rank, stars, played-at), written by the game-complete intake by
    mapping each standing's `playerId` -> the room member's `accountId` (anonymous players have none,
    so they are simply not recorded). A **total-stars** read (sum) and a **recent-plays** read
    (latest N) per account.
  - Endpoints: `PATCH /auth/avatar`, `PATCH /auth/visibility` (account sessions only), and a public
    `GET /profiles/:gamerTag` returning the visibility-gated projection (always-public gamer tag +
    stars; the rest per visibility) and 404 for an unknown tag. Extend `/auth/me` to include
    `avatar` and `visibility`.
- **web**:
  - `/u/[gamerTag]` public profile page (server-rendered, reads the public endpoint), with
    `generateMetadata` for a decent title/description.
  - `/account` self page: edit nickname (existing endpoint), avatar picker, visibility control, a
    link to view the public profile, and log out (a `logout()` client call hitting `/auth/logout`).
  - An `Avatar` component (renders the selected avatar SVG; initials fallback for a missing/unknown
    value) reused by the profile, the account page, and later the nav (spec `0028`) and lobby roster.

Out:

- **Friends** (search, connect, invite) - `friends-only` visibility is defined but, with no friend
  graph yet, resolves to "private to non-owners" and says so; real friend gating is a later spec.
- **Presence / online + player status** - a separate roadmap item.
- Avatar **upload** or custom art - the set is fixed and shipped as brand assets; no user uploads.
- The nav itself (spec `0028`) - this spec only provides the avatar, the account page, and `logout`.
- Editing another player's profile; any write to a profile you do not own.

## Approach

- **Avatars are brand SVG source, treated like code** (as marks in `0025`): author the set by hand,
  export strings from `packages/brand`, render inline - no runtime image pipeline, works in the App
  Router without webpack SVG plugins. A stored avatar is an **id** into the set, not a URL, so the
  data is a short enum-like string and the render is a lookup (unknown id -> initials fallback).
- **Two ids, public read stays minimal** (the `0025` learning): the public `GET /profiles/:gamerTag`
  never exposes email, session, or account id - only what the profile shows, gated by visibility, and
  a test asserts the private fields never appear so a later change cannot widen it into a leak.
- **Link plays to accounts at the seam that already has both ids.** The room membership maps
  `playerId -> accountId`; the game-complete intake is the one place that sees the final standings
  (by `playerId`) and can resolve the account, so it writes the per-account play there. Idempotent by
  the existing game/report id so a retry does not double-count stars (the money/idempotency learning).
- **Visibility is a projection, not a second store.** One `profile_visibility` column drives what the
  public read returns; the page renders whatever the endpoint gives it, so the rule lives in one
  place (server-side), not duplicated in the client.
- **Mobile-first, ASCII-only, canopy + Confetti.** The account page and profile read well at 360px;
  canopy `Card`/`Badge` under the `'use client'` boundary where `twigs` are used (the Theming
  learning).

## Acceptance

- [ ] The accounts migration adds `avatar` + `profile_visibility` with safe defaults; existing rows
      remain valid and a fresh signup gets a deterministic default avatar.
- [ ] `PATCH /auth/avatar` and `PATCH /auth/visibility` update the signed-in account and reject
      anonymous/unauthenticated callers; `/auth/me` reports `avatar` and `visibility`.
- [ ] Completing a game writes one `account_game_plays` row per account member (anonymous members
      recorded none), idempotent by report id; total-stars and recent-plays reads return them.
- [ ] `GET /profiles/:gamerTag` returns the gamer tag + total stars always, the rest per visibility
      (`public` full; `private`/`friends-only`-to-non-owner minimal), 404s an unknown tag, and a test
      proves email/session/account-id never appear in any branch.
- [ ] `/u/[gamerTag]` renders the profile (avatar, nickname, stars badge, recent plays) respecting
      visibility, and reads well at 360px.
- [ ] `/account` lets the owner change nickname, pick an avatar, set visibility, view their public
      profile, and log out; changes reflect on the public profile.
- [ ] Tests cover the visibility partitions, the play-recording seam (idempotent, account-mapped),
      and the profile render - not just the happy path.
</content>
