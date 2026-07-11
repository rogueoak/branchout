# 0029 - Room flow: create, pick a game, invite, change game

## Problem

The room experience is one dense screen. `RoomsHome` creates a room and drops the host straight
into `RoomClient`, whose `Lobby` piles everything together: room code, share link, roster, mode
toggle, the game picker, the selected game's config panel, and Start. A host has no guided path, the
game picker is a row of bare title buttons (no idea what a game *is* before choosing it), and there
is no way to change the game once in the room without it being tangled into the same panel.

Invites are weak: `ShareLink` prints the full URL as text with a **"Copy link"** text button, and
there is no native share sheet - the fastest way to invite on a phone (the OS share menu) is
missing.

We want a clear host flow - **create -> pick a game -> invite** - that a "Start a game" deep link
from a game feature page (spec `0030`) can short-circuit past the pick step, plus an in-room
**change game** path, richer game cards in the picker, and a proper invite surface.

## Outcome

- Creating a room runs a **stepped flow**: create the room -> **pick a game** -> **invite friends**.
  Arriving with a preselected game (the `?game=<slug>` deep link the feature-page CTA uses) **skips
  the pick step** and lands on invite with that game chosen.
- The **game picker** (first pick and the change-game flow) shows each game's **detail card** - mark,
  name, tagline, category/summary line - not just a title button, so a host chooses knowing what the
  game is.
- The **invite step** shows: the **room code as a tappable link**, a **copy button that is a copy
  icon** (not the word "Copy"), and a **share button** that opens the mobile share sheet
  (`navigator.share`) on devices that support it and falls back to copy on desktop.
- Once in the room, a **Change game** button opens the change-game flow (the same card picker),
  updating the room's selected game.
- Everywhere a join link is offered, it is the **room code text linking to the join URL** + the copy
  icon - one consistent invite affordance.
- Tested end to end per the non-negotiable: the create -> pick -> invite flow, the deep-link skip,
  change-game, and the copy/share affordances.

## Scope

In:

- **A stepped create flow** (host): after `createRoom()`, route through pick -> invite. Implement as
  distinct steps (routed sub-paths under the room, e.g. `/rooms/[code]/setup`, or an explicit step
  state in `RoomClient`) so each step is a clean mobile screen and the deep link can target invite
  directly. Decide one approach in the plan; keep URLs shareable/back-button sane.
- **`?game=<slug>` deep link**: `RoomsHome`/create reads a preselected game, calls `selectGame`
  during creation, and skips the pick step. This is the contract the feature-page CTA (spec `0030`)
  depends on - define it here.
- **Game detail cards** for the picker: a reusable `GameCard` (mark + name + tagline + summary),
  reused by both the first-pick step and the change-game flow. Sources the per-game display data
  from the web game registry (`lib/games/registry.ts`), extended with the summary/category line
  needed (kept in sync with, or shared by, the feature-page metadata in spec `0030`).
- **Invite step**: room code as a link to the join URL, a **copy-icon** button (icon, not text; an
  inline SVG like the existing arrow icon, `aria-label` for a11y), and a **share button** using
  `navigator.share` when available (title/text/url), else copy. Rework `ShareLink` into this
  icon+share affordance and reuse it wherever a join link appears (lobby included).
- **Change game in-room**: a **Change game** button in the lobby that opens the card picker and calls
  `selectGame`; the config panel follows the newly selected game.
- Keep the existing gates intact (host-only, "at least one viewer", affordability) - this is a flow/
  presentation rework, not a rule change. The control-plane stays the authority (`room-api.ts` is
  transport only).
- Update the room e2e (`e2e/`) to cover the new flow and invite affordances.

Out:

- Changing the room create/select/start **endpoints** or their rules (control-plane) - the flow uses
  the existing `createRoom`, `selectGame`, `startGame`, `controlGame`.
- The game feature pages and the CTA that produces the deep link (spec `0030`) - this spec only
  defines and consumes the `?game=` contract.
- QR codes, SMS/email invite integrations, or per-room dynamic share images (share cards are spec
  `0025`).
- The top nav (spec `0028`) - the room pages adopt it there.

## Approach

- **Steps as screens, not one panel.** Break the lobby's overloaded setup into a create-time wizard
  (pick -> invite) and a leaner in-room lobby (roster, mode, start, change-game). Each step is a
  single-purpose, phone-first screen. The deep link enters at invite with the game preset, which is
  why the step must be addressable, not just internal state.
- **Reuse the config/registry seam.** The game picker already resolves modules from the web registry
  (spec `0023`); the detail card is a presentational read of that registry plus a one-line summary,
  so adding a game stays "add a module + registry entry" with no picker edits. Keep the summary the
  single source shared with the feature page (spec `0030`) to avoid drift.
- **Progressive enhancement for share.** `navigator.share` exists on most mobile browsers and few
  desktops; feature-detect and fall back to clipboard copy, so the button always does something
  useful. The copy control is an icon with an accessible label and a transient "copied" state (the
  current `ShareLink` copy behavior, restyled).
- **Absolute URL for the shared link** (as `ShareLink` does today): resolve the relative
  `shareLink` against the origin after mount so a copied/shared link is pasteable, avoiding an
  SSR/CSR mismatch.
- **Mobile-first, ASCII-only.** Every step reads well at 360px; the share sheet is the fast path on
  a phone.

## Acceptance

- [ ] Creating a room walks create -> pick a game -> invite; each step is usable at 360px.
- [ ] Arriving at create with `?game=<slug>` selects that game and lands directly on invite,
      skipping the pick step.
- [ ] The game picker (first pick and change-game) shows each game's detail card (mark, name,
      tagline, summary), not a bare title.
- [ ] The invite step shows the room code as a link to the join URL, a copy **icon** button that
      copies the absolute link (with a "copied" state), and a share button that invokes the native
      share sheet where supported and copies otherwise.
- [ ] A **Change game** button in the room opens the card picker and updates the selected game (and
      its config panel) without leaving the room.
- [ ] Existing gates (host-only, viewer present, affordability) still hold; the control-plane rules
      are unchanged.
- [ ] The room e2e covers the new create->pick->invite flow, the deep-link skip, and change-game.
</content>
