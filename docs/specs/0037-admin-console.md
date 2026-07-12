# 0037 - Admin console (separate Next.js app, separate identity)

> Third spec of the `0035`-`0037` group. **Depends on `0035`** (the `insider` role it toggles, the Caddy
> snippets, the `.branchout.games` cookie work) and **`0036`** (the login limiter it reuses for the admin
> login). Sequence it **after both**, and after `0034` (it adds a Caddy site block and a new deploy
> service). It introduces a **new Next.js app** (`apps/admin`) and a **separate admin identity** in
> `control-plane`.

## Problem

Operators need a console to manage the product, and operator identity must be **separate from regular
accounts** - not in the player table, not reachable from the public login, not riding the public session
cookie - so a bug or compromise on the public auth surface cannot grant admin. Today there is no admin
identity at all, and no operator surface. We need a first, deliberately small admin console: sign in as
an admin, create more admins, browse users by gamer tag, open a user, and grant/revoke the `insider`
role (the toggle `0035` left as a manual DB update).

The console is a **full Next.js app** (its own service), matching `web` so it is consistent to build in
and a solid foundation for the custom operator functionality that will grow here. That adds a fourth Node
service to the droplet; the deploy-headroom work (spec `0034`: 2 GiB swap + trimmed `mem_limit`s) gives
the room, and an operator-only surface is low-traffic. It must be safe to expose on
`admin.branchout.games` - a hostname anyone can find via certificate-transparency logs.

## Outcome

- `admin.branchout.games` is served by a **new `apps/admin` Next.js service** (its own container),
  reverse-proxied by Caddy, matching how `web` is built and deployed. It calls `control-plane`
  `/v1/admin/*` same-origin.
- Admin is a **separate identity**: its own account store (not the player `accounts` table), its own
  login, and a **host-only** session cookie scoped to `admin.branchout.games` (never `.branchout.games`),
  so a player/insider session grants **no** admin access and an admin session never appears on the public
  site. There is **no public admin signup**.
- A **root admin** is reconciled from env on every boot (env is the source of truth for its password -
  break-glass recovery); the root admin and any admin can **create more admins**.
- A signed-in admin can:
  - view a **users table** listing players by **gamer tag** (searchable, paginated);
  - open a user to see their **profile**, and **grant/revoke** that user's `insider` role;
  - view the list of admins and **create a new admin**.
- The admin login is **rate-limited/lockable** (reusing `0036`, anchored on the admin account).
- Auth is gated **server-side** in the admin app (SSR middleware/layout redirects to the admin login when
  there is no valid admin session) **and** authoritatively enforced by `control-plane` on every
  `/v1/admin/*` call - defence in depth.
- The console is usable at 360px (desktop-leaning is fine).
- An end-to-end test proves the operator flow and the identity boundary (a player - even an insider -
  gets no admin access).

## Scope

In:

- **`apps/admin`** (new): a **Next.js app** built like `apps/web` (App Router, its own `Dockerfile`,
  a `/health` route, the shared theme/canopy look and feel). Pages: **admin login**; **users list**
  (search by gamer tag + pagination); **user detail** (profile + insider grant/revoke); **admins list +
  create-admin form**. **Server-side** auth gating (middleware + a layout that reads the admin session via
  a server-side `/v1/admin/auth/me` call and redirects to the admin login when absent); `control-plane`
  remains the authoritative gate on every `/v1/admin/*` request. Its own `NEXT_PUBLIC`/server env for the
  control-plane origin, mirroring `web`'s client/server URL split.
- **Separate admin identity in `control-plane`**:
  - an **`admin_accounts`** table (own id, email/username, password hash via the existing hasher,
    `created_by`, timestamps) - **not** the player `accounts` table; migration added;
  - an **admin session** in Redis under a **separate namespace**, carried by a **distinct, host-only**
    cookie (own name; `Domain` unset; `HttpOnly`, `Secure`, `SameSite=Lax`), revocable like player
    sessions;
  - **root-admin bootstrap**: on boot, reconcile the root admin from `ADMIN_ROOT_EMAIL` +
    `ADMIN_ROOT_PASSWORD` (env is source of truth for the password - upsert the hash); documented. **No
    public admin signup.**
- **Admin API** under `/v1/admin/*`, all admin-session-gated except login:
  - `POST /v1/admin/auth/login` (**reuses the `0036` limiter**, keyed on the admin account),
    `POST /v1/admin/auth/logout`, `GET /v1/admin/auth/me`;
  - `POST /v1/admin/admins` (create admin);
  - `GET /v1/admin/users?query=&page=` (players by gamer tag, searchable + paginated);
  - `GET /v1/admin/users/:id` (profile);
  - `POST /v1/admin/users/:id/insider` (grant/revoke the `insider` role from `0035`).
- **`deploy/docker/Caddyfile`**: an `admin.branchout.games` block that `import site_base`, **reverse-proxies
  `/api/*` -> control-plane** same-origin (a shared snippet, no `/ws` - admin has no WebSocket), and
  proxies everything else to the **`admin` service** (dynamic upstream, like `web`).
- **`deploy/docker/compose.site.yml`** + **`.github/workflows/release.yml`**: add the `admin` service
  (private GHCR image, `edge` network, `expose` its port, healthcheck, a `mem_limit`/`mem_reservation`
  sized for a low-traffic SSR tier) as a **fourth docker-rollout target** (rolled after `web`; it depends
  on `control-plane`). Build + push the `admin` image in CI.
- **`overview/architecture.md`** + **`deploy/README.md`**: the separate admin identity model, the
  host-only admin cookie, the root-admin env bootstrap (mechanism only - no values), the `admin` DNS
  record, the new service + its place in the rollout/capacity budget, and the deferred admin hardening
  (MFA).
- **End-to-end test** (Playwright, per `0026`): seeded root admin logs in -> creates an admin -> that
  admin logs in -> views users -> opens a user -> grants `insider` -> that user now sees the `0035`
  insiders surface; and the boundary checks: a **player/insider session gets no admin access**, an
  unauthenticated `/v1/admin/*` call is 401, and the admin login is rate-limited.

Out:

- **Deleting or disabling admins**, and admin roles/permissions tiers - v1 is create-only; the root admin
  is not deletable. (Revocation/disable is a follow-up.)
- **Any user management beyond the insider toggle** (no ban, edit, delete of players) - view + insider
  grant/revoke only.
- **MFA / SSO / step-up re-auth for admin** - deferred hardening, documented not built (rate limiting
  from `0036` is the v1 control).
- **A management UI for `insider` outside admin**, and **admin self-service password reset** - out.
- **Trusting the client IP for the admin login's per-IP limit** - the admin login anchors on the admin
  account (spoof-resistant); a trustworthy client IP is a separate hardening (see the XFF follow-up).
- **Actual insider game content** on the insiders surface - `0035`/later.

## Approach

- **A Next.js app, for consistency and room to grow.** Building `apps/admin` the same way as `apps/web`
  (App Router, Dockerfile, health route, shared theme) means the console is consistent to develop and a
  natural home for the custom operator features that will accrue here - the reason we chose a full app
  over a static export. It costs a fourth Node service; the swap + trimmed `mem_limit`s from `0034` give
  the headroom and an operator-only surface stays light, so it gets its own modest `mem_limit`.
- **Separate identity, seeded, never self-serve.** Admins live in their own table with their own
  credentials and a **host-only** cookie, so a player session can never satisfy the admin gate and an
  admin session can never appear on the public site. The only ways to become an admin are the env-seeded
  root (source of truth on boot, for break-glass) or an existing admin creating one - there is no public
  admin signup. This is the concrete meaning of "admins are separate from regular accounts".
- **Gate twice: SSR in the app, authoritative in control-plane.** Because it is a real server, the admin
  app gates server-side (middleware/layout) so an unauthenticated request never renders admin UI; but the
  security boundary is `control-plane`, which re-checks the admin session on **every** `/v1/admin/*`
  request. The app gate is UX + defence-in-depth, not the sole check.
- **Reuse, don't rebuild.** The `insider` role (`0035`), the login limiter (`0036`), the Caddy
  `site_base`/api snippet (`0035`), the password hasher, and the Redis session pattern already exist; this
  spec wires them together for the admin surface rather than reinventing them.
- **Same-origin admin API, no CORS.** Caddy proxies `admin.`'s `/api` to control-plane under the same
  origin, so the admin cookie is first-party and no CORS/`SameSite=None` is needed.
- **Prove the flow and the boundary.** The risk is authorization, so the e2e test walks the real operator
  path (login -> create admin -> toggle a user's insider -> that user sees insiders) **and** asserts the
  negatives (player/insider denied admin, unauthenticated admin API 401, admin login rate-limited).

## Acceptance

- [ ] `admin.branchout.games` is served by the new `apps/admin` Next.js service via a Caddy reverse-proxy
      block that proxies `/api/*` to control-plane same-origin; the service is a docker-rollout target with
      its own `mem_limit`.
- [ ] `control-plane` has an `admin_accounts` table (separate from `accounts`), an admin session in a
      separate Redis namespace, and a **host-only** admin cookie scoped to `admin.branchout.games`.
- [ ] A root admin is reconciled from `ADMIN_ROOT_EMAIL`/`ADMIN_ROOT_PASSWORD` on boot (env is source of
      truth); there is no public admin signup; documented (mechanism only, no values).
- [ ] All `/v1/admin/*` routes except login require a valid admin session; the admin login reuses the
      `0036` limiter, anchored on the admin account.
- [ ] The admin app gates unauthenticated requests server-side (redirect to the admin login) and
      `control-plane` enforces the admin session on every `/v1/admin/*` call.
- [ ] A signed-in admin can create another admin, list players by gamer tag (search + pagination), open a
      user's profile, and grant/revoke that user's `insider` role.
- [ ] A player/insider session gets no admin access; an unauthenticated `/v1/admin/*` call returns 401.
- [ ] The console is usable at 360px.
- [ ] A Playwright e2e test walks root-login -> create-admin -> admin-login -> view users -> toggle a
      user's insider -> that user sees the insiders surface, and asserts the boundary negatives; it passes
      in CI.
- [ ] `overview/architecture.md` and `deploy/README.md` document the separate admin identity, the
      host-only cookie, the root-admin env bootstrap, the `admin` DNS record, the new service in the
      rollout/capacity budget, and the deferred MFA hardening.
