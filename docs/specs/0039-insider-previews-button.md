# 0039 - Insider previews entry point

> Small follow-on to `0035` (the insider surface) and `0037` (the admin insider toggle). Those built
> the `insider.` surface and a way to grant the role; this adds the missing **door**: a link from the
> account page to the surface, shown only to insiders.

## Problem

An account can be granted the `insider` role (manually per `0035`, or via the admin console per
`0037`), and `insider.branchout.games` serves the surface - but a player has no way to *discover or
reach* it from the app. There is no link anywhere; a tester has to know and type the subdomain. The
account page is where a player manages their identity, so it is the natural home for an entry point,
gated to insiders so non-insiders never see a door they cannot open.

## Outcome

- On `/account`, an account with the `insider` role sees an **"Insider game previews"** button that
  links to the insider surface (`insider.branchout.games` in prod; `insider.localhost:<port>` in
  dev/e2e).
- A non-insider account sees **nothing** - the button is not rendered at all (not merely disabled),
  so the surface is not advertised to accounts that cannot use it.
- The button is mobile-first: usable and good-looking at 360px, matching the existing account-page
  controls.

## Scope

In:

- **`apps/web/lib/account-api.ts`**: add `insider?: boolean` to the `MeAccount` interface. The
  control-plane `GET /v1/auth/me` already returns `insider` (the SSR `lib/session` reads it); this
  surfaces the existing field to the client account page.
- **`apps/web/lib/subdomain.ts`**: add a pure helper `insiderOrigin(apexOrigin)` that inserts the
  existing `INSIDER_PREFIX` before an origin's hostname (`https://branchout.games` ->
  `https://insider.branchout.games`; `http://localhost:3100` -> `http://insider.localhost:3100`),
  keeping it unit-testable without the Next runtime.
- **`apps/web/app/account/AccountClient.tsx`**: when `account.insider`, render an "Insider game
  previews" link styled with Canopy `buttonVariants`, pointing at `insiderOrigin` of the apex origin
  (`NEXT_PUBLIC_SITE_URL`, falling back to `window.location.origin`).
- **Unit test** (`apps/web/middleware.test.ts`, where the `subdomain` helpers are tested): cases for
  `insiderOrigin`.
- **End-to-end test** (Playwright, per `0026`): a fresh account does not see the button; after the
  role is granted and the page reloads, the button is visible and targets the insider host.

Out:

- Changing how the role is granted (that is `0037`), the insider surface content (`0035`), or the
  cross-subdomain cookie (`0035`).

## Approach

- **Reuse the existing `insider` plumbing.** The role already rides on `/auth/me`; the only gap is
  the client type and a link. No control-plane change.
- **Hide, don't disable.** A non-insider gets no button, so the surface stays invisible to accounts
  that cannot enter it.
- **Derive the host, don't hardcode it.** `insiderOrigin` reuses `INSIDER_PREFIX` so the dev/e2e
  (`insider.localhost`) and prod (`insider.branchout.games`) hosts both fall out of the apex origin.

## Acceptance

- [ ] `MeAccount` carries `insider`; the account page reads it from `/auth/me`.
- [ ] An insider account sees an "Insider game previews" button on `/account` that links to the
      insider host; a non-insider account sees no such button.
- [ ] `insiderOrigin` is unit-tested for the apex and localhost origins (and a trailing slash).
- [ ] A Playwright e2e test covers the not-shown / shown-after-grant paths and the link target, and
      passes in CI.
- [ ] The button is usable and fits a 360px phone.
