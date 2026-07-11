# 0028 - Top nav and account menu

## Problem

There is no shared site navigation. The landing page hand-rolls a header (wordmark + a lone "Log in"
link inside `LandingContent`), `RoomsHome` renders its own centered wordmark, and the join and room
pages have no chrome at all. A visitor cannot get to the games, and a signed-in player has no visible
account affordance - no way to reach their profile or log out from a page.

We want one **top nav**, present on the marketing and room-hosting/joining surfaces (but **not**
inside a running game, where chrome would compete with play): a **Games** link on the left, and on
the far right a **Sign up** (the primary CTA) and **Log in**. Once signed in, those two buttons are
replaced by the player's **avatar** (from spec `0027`); clicking it opens a dropdown to **manage
account** or **log out**.

## Outcome

- A shared **`TopNav`** renders: the wordmark (home link) + a **Games** link on the left; on the
  right, when signed out, **Log in** and a **Sign up** primary CTA; when signed in, the player's
  **avatar** button opening a menu with **Manage account** (-> `/account`, spec `0027`) and
  **Log out**.
- The nav appears on the **marketing pages** (home, game feature pages, privacy/terms) and the
  **room hosting/joining pages** (`/rooms`, `/rooms/[code]` lobby, `/join`), and is **absent inside a
  running game** (the in-game stage keeps its minimal own header).
- **Log out** clears the session and returns to a signed-out home; the nav reflects auth state
  without a full reload where practical.
- Mobile-first: the nav collapses to a phone-friendly layout (Games + the right-side action/avatar)
  at 360px; the account menu is keyboard- and screen-reader-accessible.
- Covered by tests: signed-out vs signed-in rendering, the menu actions, and the in-game omission.

## Scope

In:

- A **`TopNav`** component (canopy + Confetti), taking the caller's auth state (signed in + the
  minimal identity: gamer tag, nickname, avatar) so it can render server-side without a flash. Reuse
  the `Avatar` component from spec `0027`.
- An **account dropdown menu** (accessible: focus trap/roving, `Escape` to close, `aria-expanded`),
  items: Manage account (`/account`), Log out. Log out calls the `logout()` client helper (spec
  `0027`, `POST /auth/logout`) then routes to `/`.
- **Wiring the nav into the layouts** of: the home page, `/rooms`, `/rooms/[code]` **lobby state**,
  `/join`, and (spec `0030`/`0031`) the game feature and legal pages. Replace the bespoke header in
  `LandingContent` and the lone wordmark in `RoomsHome` with the shared nav.
- **Omitting the nav inside a running game**: `RoomClient` renders the nav in the lobby but not once
  `status === 'running'` (the game stage keeps its existing compact room-code/leave header).
- The signed-in identity read: the pages already know `signedIn` server-side (`lib/session.ts`);
  extend that read to also return the gamer tag + nickname + avatar the nav needs (or add a sibling
  `getViewer()` helper), keeping the server/client URL split.

Out:

- The **avatar art, account page, and `logout` helper** themselves - spec `0027` ships them; this
  spec consumes them.
- A full mobile hamburger/drawer nav with deep sections - the nav is small (Games + account), so a
  simple responsive layout suffices; a drawer is a later concern if the nav grows.
- Search, notifications, friends, or presence in the nav.
- Restyling the in-game header or the marketing page bodies beyond swapping in the shared nav.

## Approach

- **One component, injected auth state, no flash.** The nav takes `signedIn` + identity as props from
  the server component that renders the page (the pattern `page.tsx` -> `LandingContent(signedIn)`
  already uses), so the correct signed-in/out nav renders on the first byte. A client boundary wraps
  it only where interactivity (the dropdown, logout) needs it - and because it renders canopy `twigs`
  it declares `'use client'` with a comment naming why (the Theming learning).
- **Presence by surface, not a global layout slot.** Rather than force the nav into the root
  `app/layout.tsx` (which also wraps the in-game route), each surface opts in by rendering `TopNav`.
  This keeps the running-game view chrome-free without a fragile "hide on this route" check, and lets
  the room page swap header by phase (lobby: nav; running: compact header).
- **Sign up is the one primary.** On the signed-out nav, **Sign up** is the sole `primary` button and
  **Log in** is a quiet link/secondary - honoring the one-primary-per-view rule (the CTA-hierarchy
  learning) so the far-right CTA reads as the main action.
- **Accessible menu.** Build the dropdown on an accessible pattern (a canopy menu if available, else
  a small headless disclosure with proper ARIA and keyboard handling), not a hover-only popover, so
  it works on touch and with a screen reader.
- **Mobile-first, ASCII-only.** At 360px the nav is wordmark + Games on the left, action/avatar on
  the right; nothing wraps awkwardly.

## Acceptance

- [ ] `TopNav` renders Games + wordmark on the left; signed out, it shows Log in and a single primary
      Sign up; signed in, it shows the player's avatar button in their place.
- [ ] The avatar menu opens to Manage account (`/account`) and Log out, is keyboard- and
      screen-reader-accessible, and closes on `Escape`/outside click.
- [ ] Log out clears the session and lands on a signed-out home with the signed-out nav.
- [ ] The nav is present on home, `/rooms`, the `/rooms/[code]` lobby, `/join`, and the feature/legal
      pages, and is absent once a game is running.
- [ ] The nav is correct at first paint (no signed-in/out flash) and usable at 360px.
- [ ] Tests cover signed-out vs signed-in rendering, the menu actions (including logout), and the
      in-game omission.
</content>
