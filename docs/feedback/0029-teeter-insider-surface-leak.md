# 0029 - Teeter Tower leaks onto the main site (insider surface gaps)

Captured from playtesting the insider surface. Teeter Tower is an insider-only game (spec 0043),
but three gaps let it cross onto the apex and made its insider surface feel broken.

## Symptom

1. **Teeter shows in the main-site room picker.** Signed in as an insider on the apex
   (`branchout.games`), opening a room and tapping "Choose game" listed Teeter Tower. An
   insider-only game should not exist on the main site at all.
2. **Starting Teeter from the insider site jumps to the apex.** On `insider.branchout.games`,
   tapping a game card sent the browser to `branchout.games/rooms?game=...` - the player left the
   insider surface to play an insider game.
3. **The insider game card has no logo.** The insider home cards rendered name/tagline/summary but
   never the game's mark, unlike the main-site `GameCard`.

## Root cause

- **Entitlement, not surface, gated the picker.** `GamePicker` was fed `viewer.insider`
  (RoomClient), so an insider saw insider games *everywhere*, including the apex. Visibility should
  follow the *site you are on*, not who you are.
- **The room flow only existed on the apex.** The insider host rewrites every page path into the
  `/insider` tree (spec 0035), and that tree had only a landing page - no room/join routes. So the
  insider home had to link across to the apex to let anyone actually play.
- **The insider home hand-rolled its card** and omitted `game.icon`; the reusable `GameCard`
  (which inlines the mark) was not used.

## Fix

- **Surface-based visibility.** A server helper (`lib/surface.ts`, `getSurface()`) reads the request
  host: on the insider host it reports `insider: true` plus the apex `linkOrigin` for shared chrome;
  on the apex, `insider: false`. The room pages pass this surface to the picker and the deep-link
  guard instead of `viewer.insider`, so Teeter never appears on the apex - even for an insider - and
  the `?game=teeter-tower` deep link is ignored on the apex.
- **Room flow under the gated `/insider` tree.** New `app/insider/rooms`, `app/insider/rooms/[code]`,
  and `app/insider/join` routes re-export the apex pages, so `insider.branchout.games/rooms...`
  serves the same flow, stays on the insider host, and stays protected by the insider layout gate.
  The shared chrome crosses its marketing/legal links back to the apex via `linkOrigin` (feedback
  0019), while the flow's own relative links (`/rooms/CODE`, `/join`) stay on the insider host.
- **Insider home uses `GameCard`** (relative `playHref`, no apex origin), so the card shows the mark
  and one tap starts a room without leaving the insider surface.
- **Same-origin `/api` in dev/e2e.** The insider room flow makes credentialed browser calls, which in
  prod hit `/api` same-origin (Caddy re-serves it per host - apex AND `insider.`). Dev/e2e had the
  browser call an absolute cross-origin control-plane URL, which cannot carry the session from
  `insider.localhost` over http (SameSite + `*.localhost` are cross-site). The web app's `next.config`
  now proxies `/api` -> the server-side `CONTROL_PLANE_URL`, emitted only when
  `NODE_ENV !== 'production'` (prod's `web` sets `CONTROL_PLANE_URL` for SSR too, so guarding on that
  alone would ship the proxy in prod and expose the internal `/api/v1/engine/*` endpoint on the web
  tier; Caddy owns `/api` in prod). The e2e overlay points the browser at `/api` - so the e2e stack
  faithfully mirrors prod and the insider room flow (create/select/start + the live Teeter engine
  loop) is proven on the insider host.

## Intended consequence

A shared teeter room link resolves against the insider origin, so only insiders can open it
(the insider layout gates non-insiders). That is correct for an insider-only test game.

## Learning

Visibility of a surface-scoped game must be gated by the **surface** (the host), not the viewer's
entitlement - otherwise an entitled user carries the private game onto the public site. And "keep the
player on this surface" requires the surface to actually host the flow: a rewrite-based subdomain
that only has a landing page has to bounce to the apex to do anything. Generalize into
`overview/learnings.md`.
