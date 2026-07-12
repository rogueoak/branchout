# 0035 - Subdomains + the insiders surface

> First spec of a three-spec group (`0035` insiders surface, `0036` login rate limiting, `0037` admin
> console). It owns the **shared subdomain setup** the group needs: the DRY Caddy proxy snippet and the
> host-aware `web` middleware; `0037` reuses both for `admin.`. It touches `deploy/docker/Caddyfile`
> (also edited by `0033`/`0034`), so sequence it **after** `0034` to avoid a conflict and to inherit
> the swap + trimmed `mem_limit`s. `0036` and `0037` build on the `insider` role introduced here.

## Problem

We want a beta-tester surface at `insiders.branchout.games` where insiders can try in-development games,
without a second Next.js process on a RAM-bound droplet. The stack is single-origin and path-routed
today, and there is **no account-level entitlement**: `role` is only `player` / `observer` *within a
room*, so nothing marks an account as a beta tester. The insiders surface needs (a) a way to route a
subdomain into the existing `web` app and (b) an account-level `insider` role to gate it.

Insiders are ordinary players who should get **one login** across the game and the insiders surface, so
this is a role on the regular account - not a separate identity (that distinction is the admin console's
job, `0037`).

## Outcome

- `insiders.branchout.games` resolves, serves valid HTTPS, and is served by the **existing `web`
  process** - no new container, no measurable RAM increase.
- One login spans the apex and `insiders.` (the player session cookie is scoped to `.branchout.games`).
- A request to `insiders.` is served the insider tree **only if** the signed-in account carries the
  `insider` role; otherwise it is refused (signed-out -> login; signed-in-without-role -> 403).
- The apex cannot reach the insider tree by typing its internal path - the subdomain is the only door.
- The insiders surface is an **index page of insider games** (empty-state for now) that uses the main
  site's look and feel, with a clear **"Insiders" label in the top-right** so a tester always knows
  which surface they are on. It is **mobile-first** (usable and good-looking at 360px).
- Granting the role is a documented manual DB update for now; the admin UI to toggle it lands in `0037`.

## Scope

In:

- **`apps/web/middleware.ts`** (new): read the request `Host`, derive the subdomain label, and
  - `insiders`: gate on the player session carrying the `insider` role, then **rewrite** invisibly into
    `/insiders*` (unauthenticated -> login; authenticated-without-role -> 403);
  - apex / `www` / `localhost`: pass through, and **404 any direct `/insiders` path** so the tree is
    unreachable except via the subdomain;
  - `matcher` excludes `api/`, `_next/`, the PostHog `ingest/` proxy (see `next.config.mjs`), and
    static files.
- **`insider` role** in `control-plane`: add the flag to the account model (migration), surface it on
  the player session and on `GET /v1/auth/me` (the shape `web` already hydrates from). Grant via a
  documented DB update for now.
- **Player-session cookie scope**: set the session cookie `Domain=.branchout.games` in prod
  (`SessionCookieConfig`), host-only in local/dev; confirm `SameSite=Lax` still holds (same-site across
  subdomains; every surface is same-origin for its own `/api`, so no `None`).
- **Insiders route tree**: `apps/web/app/insiders/*` with an index page (a list of insider games with an
  empty state), rendered in the shared layout/top-nav with an **"Insiders" badge top-right**; keep the
  main site under a `(main)` route group so it stays at `/`. A shared server-side guard (extend
  `apps/web/lib/session`) that the insiders layout calls to re-check the role as the authoritative gate.
- **`deploy/docker/Caddyfile`**: introduce a reusable **snippet** for the same-origin `/api` + `/ws`
  dynamic-upstream blocks (shared setup for the group), and add an `insiders.branchout.games` site block
  that `import`s it and proxies `*` to `web:3000`, with `encode` + HSTS. `www` redirect unchanged.
- **`overview/architecture.md`** + **`deploy/README.md`**: document host-aware routing, the `insider`
  role and how to grant it, the required `insiders` DNS A record, and the apex-cannot-reach rule.
- **End-to-end test** (Playwright, per `0026`): an insider account sees the surface; a signed-out visitor
  is routed to login; a signed-in **non-insider** is refused; the apex 404s `/insiders`.

Out:

- **The admin console, admin identity, and the insider-toggle UI** - `0037` (granting `insider` is a
  manual DB update until then).
- **Login rate limiting** - `0036`.
- **Actual insider game content** - the index ships with an empty state; games are added later.
- **A second Next.js app / container** for insiders - it is served by the existing `web` process.
- **Wildcard TLS / CORS** - per-hostname ACME cert; each subdomain is same-origin for its own `/api`.

## Approach

- **Host-aware middleware, not a second app.** Next middleware reads `Host` (Caddy preserves the
  original `Host` upstream by default, so `web` sees `insiders.branchout.games`) and invisibly rewrites
  the subdomain's requests into `/insiders`. Links inside the tree are written prefix-free (`/games`,
  not `/insiders/games`) and re-enter middleware on the same host. One process, real subdomain.
- **Routing is not authorization - gate twice.** The subdomain is public; middleware keeps
  non-insiders out of the tree, and the tree layout re-checks server-side as the authoritative gate.
- **One login, because insiders are players.** A `.branchout.games`-scoped cookie carries a tester from
  the game to the insiders surface; the `insider` role - not a second login - decides what they see.
- **Ship the shell now.** The index is an empty-state list behind the gate, proving the whole
  route-and-guard flow end-to-end; games are added later without touching the routing.
- **Own the shared setup here.** The Caddy snippet and the middleware are the group's foundation;
  building them in the first spec keeps `0037` small.

## Acceptance

- [ ] `insiders.branchout.games` serves over HTTPS from the existing `web` container; no new app
      container is added and steady-state RSS is unchanged.
- [ ] `apps/web/middleware.ts` gates `insiders` on the player session's `insider` role, rewrites into
      `/insiders`, 404s direct `/insiders` access from the apex, and excludes `api/` `_next/` `ingest/`
      and static files.
- [ ] `control-plane` adds an `insider` role on accounts, surfaced on the session and `GET /v1/auth/me`,
      grantable via a documented DB update.
- [ ] The player cookie is `Domain=.branchout.games` in prod (host-only in dev); one login is honored on
      the apex and `insiders.`.
- [ ] The insiders index renders in the main look/feel with an "Insiders" label top-right, shows an
      empty state, and is usable and good-looking at 360px.
- [ ] Insider sees the surface; signed-out is routed to login; signed-in non-insider gets 403 - enforced
      in both middleware and the insiders layout.
- [ ] `deploy/docker/Caddyfile` has the reusable api/ws snippet and an `insiders` block that proxies to
      `web` with `encode` + HSTS.
- [ ] A Playwright e2e test covers the insider / signed-out / non-insider paths and the apex-404 rule and
      passes in CI.
- [ ] `overview/architecture.md` and `deploy/README.md` document the routing, the `insider` role and how
      to grant it, the `insiders` DNS record, and the apex-cannot-reach rule.
</content>
