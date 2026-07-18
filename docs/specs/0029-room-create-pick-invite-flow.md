# 0029 - Room flow: create, pick a game, invite, change game

> **Revision (2026-07-18, front-door consolidation).** Starting a game from a game surface now
> **skips the create-room step**: the `?game=<slug>` deep link creates the room and drops the host
> straight into the lobby with the game selected - no intermediate "Create a room" tap. A **"Join"**
> link is added to the top nav, going straight to `/join`. The stepped create -> pick -> invite wizard
> below still governs the *no-game* create path and the in-room change-game flow. Updated in place.

## Problem

The room experience was one dense screen, and getting *into* a game still had friction. The original
`RoomsHome` created a room and dropped the host into `RoomClient`, whose `Lobby` piled everything
together (code, share link, roster, mode toggle, picker, config, Start). The stepped flow (below)
fixed the density. But even with a game chosen upstream (a "Start a game" CTA on a feature page or a
card, spec `0065`), the host still landed on `RoomsHome` and had to tap **"Create a room"** before a
room existed - the `?game=` deep link only skipped the *picker*, not the create page. That is an extra
tap and an extra screen between "I want to play this game" and "I'm in the lobby inviting friends".

Separately, a returning player who just wants to enter a code has no direct path: `/join` is reachable
only from the rooms landing or a share link, not from the nav.

We want: **"Start a game" creates the room and lands the host in the lobby in one step**, and a
**"Join" nav link** straight to `/join`.

## Outcome

- **Start-a-game skips create.** Arriving at the room flow with `?game=<slug>` (the deep link every
  "Play now" / "Start a game" affordance uses, spec `0065`) - for a signed-in host who can host -
  **creates the room, selects the game, and routes to the lobby** with no "Create a room" tap and no
  pick step. The host lands on `/rooms/{code}` (the lobby) ready to invite.
  - A signed-out visitor still routes through signup first (the existing `startGameHref` ->
    `/signup?next=...` contract), then completes the same auto-create on return.
  - Insider games auto-create only on the insider surface (the existing surface gate); on the apex an
    insider slug is ignored and falls back to the normal create landing.
  - Auto-create is **idempotent per arrival**: once the room is created the URL is replaced with
    `/rooms/{code}` so a refresh or back-navigation does not create a second room.
- **Plain create still works.** Visiting the room flow with **no** `?game=` shows the create/join
  landing (Create a room / Join a room), and creating there walks the stepped flow: create -> **pick a
  game** -> lobby. (The invite affordances now live in the lobby, per the earlier revision.)
- **Join in the nav.** The top nav (spec `0028`) gains a **"Join"** link that goes straight to
  `/join`, so a player with a code reaches the join screen in one tap from anywhere. It is a
  surface-owned link (stays relative, so on the insider host it lands on the rewritten insider join).
- The **game picker** (the no-game create path and the in-room change-game flow) shows each game as a
  unified `GameCard` (spec `0065`) in its selectable variant.
- Existing gates hold (host-only, "at least one viewer", affordability); the control-plane stays the
  authority. Tested end to end: the deep-link auto-create -> lobby, the no-game create -> pick, the
  Join nav link, and change-game.

## Scope

**In**

- **Auto-create on the deep link.** When the room flow loads with a valid `?game=<slug>` and the
  viewer is a signed-in host, run the existing `createRoom` + `selectGame` sequence automatically
  (the logic already in `RoomsHome.onCreate`, previously gated behind the "Create a room" button) and
  `router.replace` to `/rooms/{code}` (the lobby - no `?step`). Guard it so it fires once per arrival
  (a ref/flag) and never double-creates on re-render or back-nav.
  - Keep the surface gate: an insider slug only auto-selects on the insider surface; otherwise ignore
    the slug and show the landing.
  - Failure (create/select error, control-plane unreachable) falls back to the create landing with a
    clear message, not a dead end.
- **"Join" nav link** in `TopNav` (spec `0028`), beside "Games", relative `/join` (surface-owned, not
  crossed to the apex), with the a11y/label conventions the other nav links use.
- The **no-game create path** and the **in-room change-game** flow keep using the stepped
  create -> pick pattern and the unified `GameCard` picker (spec `0065`).
- Keep the existing invite affordances in the lobby (room code as a link, copy icon, native share).
- Keep all gates intact (host-only, viewer present, affordability); `room-api.ts` stays transport
  only; the control-plane endpoints (`createRoom`, `selectGame`, `startGame`, `controlGame`) are
  unchanged.
- Update the room e2e (`e2e/`) to cover: the deep-link auto-create landing directly in the lobby (no
  "Create a room" tap), a refresh not creating a second room, the "Join" nav link reaching `/join`,
  the no-game create -> pick flow, and change-game.

**Out**

- Changing the room create/select/start **endpoints** or their rules (control-plane).
- The **feature page / cards** that produce the deep link (specs `0030`, `0065`) - this spec consumes
  the `?game=` contract, it does not define the card.
- The **signup redirect** mechanics for a signed-out starter (the existing `?next=` contract is
  reused, not changed).
- The join page's **name field behavior** (autofill / remembered name / random name) - spec `0066`.
- QR codes, SMS/email invites, per-room dynamic share images (spec `0025`).

## Approach

- **Reuse the create sequence, drop the button gate.** `onCreate` already does `createRoom` ->
  (deep-link) `selectGame` -> route to the lobby when a game is preselected. The change is to run that
  path **automatically on mount** when a valid `?game=` is present and the host can host, instead of
  waiting for a tap - and to `router.replace` (not `push`) so the created-room URL supersedes the
  `?game=` URL and a back/refresh cannot re-trigger the create. A one-shot guard (a ref set before the
  first create) prevents a double-create under React re-render/StrictMode.
- **Keep the manual landing for the no-game case.** With no `?game=`, nothing auto-runs; the host sees
  Create a room / Join a room and the stepped pick flow, exactly as before. This preserves the
  browse-then-host path and the plain "I'll pick in the room" path.
- **Join is a surface-owned nav link.** `/join` is rewritten into the insider tree on the insider
  host, so the nav link stays relative (like Games and the wordmark) and must not be crossed to the
  apex via `linkOrigin` - otherwise an insider would be bounced off-surface (feedback `0030`).
- **Signed-out and error paths stay graceful.** A signed-out starter is already sent to signup with
  `?next=` and returns to the deep link; an auto-create failure shows the create landing with a
  message rather than a spinner or a blank screen.
- **Mobile-first.** One fewer screen and one fewer tap to get into a game; the Join link is a
  thumb-reachable nav entry for the "I have a code" player.

## Acceptance

- [ ] Arriving at the room flow with `?game=<slug>` as a signed-in host creates the room, selects the
      game, and lands **directly in the lobby** (`/rooms/{code}`) with no "Create a room" tap and no
      pick step.
- [ ] A refresh or back-navigation after that auto-create does **not** create a second room (the URL
      is replaced; the create fires once per arrival).
- [ ] A signed-out visitor starting a game is routed through signup and, on return, completes the same
      auto-create into the lobby.
- [ ] An insider slug auto-creates only on the insider surface; on the apex it is ignored and the
      create landing shows.
- [ ] Visiting the room flow with **no** `?game=` shows the create/join landing and the stepped
      create -> pick flow; the picker uses the unified `GameCard` (spec `0065`).
- [ ] The top nav shows a **"Join"** link that navigates straight to `/join` (relative/surface-owned,
      correct on both the apex and the insider host).
- [ ] A **Change game** button in the room still opens the card picker and updates the selected game.
- [ ] Existing gates (host-only, viewer present, affordability) still hold; the control-plane rules
      are unchanged.
- [ ] The room e2e covers the deep-link auto-create -> lobby, no double-create on refresh, the Join
      nav link, the no-game create -> pick flow, and change-game. `pnpm build`, lint, typecheck, and
      tests are green.
