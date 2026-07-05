# 0005 - Landing page

## Problem

Branch out has no front door. A first-time visitor hitting `/` should learn what it is in a
few seconds and be pushed to sign up. The scaffold's placeholder home does not sell anything or
convert.

## Outcome

- `/` renders a branded marketing page: what Branch out is, how it works, the tiers, and a clear
  primary call to action to sign up free.
- The page uses canopy components, the Confetti theme (`0002`), and the brand assets (`0003`);
  it looks right in light and dark and is responsive and accessible.
- The primary CTA takes a visitor to sign-up (`0004`). A visitor who is already signed in sees a
  "Play now" CTA to their lobby instead of "Sign up free".

## Scope

In:
- The `/` route in `apps/web` (server-rendered): a header with the wordmark and a **"Log in"**
  link (to `/login`), then sections in order: hero (logo + wordmark, tagline "where game night
  grows", one-line pitch, primary "Sign up free" CTA to `/signup`, secondary "Browse games");
  "how it works" in three steps (make a room, share the code, play together);
  the tier table (Free / Gathering / Party with prices and daily credits); a games teaser strip
  (static, Trivia featured); a short footer.
- Signed-in vs anonymous CTA swap using the accounts session from `0004`.
- SEO + OpenGraph metadata using the brand OpenGraph image from `0003`.

Out:
- The sign-up flow and auth itself (`0004`). Real game-catalog data (the teaser is static for
  now). Any payment or checkout (later monetization spec). A logged-in dashboard/lobby (rooms
  specs).

## Approach

- One `/` route composed from canopy `Card`, `Button`, `Badge`, and layout primitives - no
  one-off styling; reuse theme tokens. One primary action per view; the secondary CTA is visibly
  secondary.
- Copy follows Trellis language rules: warm, terse, address the reader as "you", ASCII only, no
  marketing hype. Lead with what it does.
- The primary CTA links to `/signup` and the header "Log in" links to `/login`; both pages are
  delivered by `0004`. If `0004` has not merged yet, the links point at routes that 404 in dev -
  keep the dependency explicit rather than faking a flow.
- Conditionally render the signed-in CTA by reading the session server-side; if accounts are not
  wired yet, default to the anonymous view behind a flag.

## Acceptance

- [ ] `/` shows hero, how-it-works, tiers, games teaser, and footer, with one primary "Sign up
      free" CTA to `/signup` and a header "Log in" link to `/login`.
- [ ] Renders correctly in light and dark and down to a phone width; passes basic a11y checks
      (landmarks, headings, contrast via the AA-verified theme, focus states).
- [ ] A signed-in visitor sees "Play now" instead of "Sign up free".
- [ ] OpenGraph/social preview uses the brand image; page has a title and meta description.
- [ ] Copy passes the Trellis language quick test; no hardcoded colors or magic numbers.
