# Plan 0037 - Admin console (separate Next.js app, separate identity)

Source spec: `docs/specs/0037-admin-console.md`. Branch `feat/0037-admin-console`. Depends on merged
`0035` (insider role) + `0036` (limiter); sequence after `0038` (shares the Caddy `(api)` snippet).

## Design decisions

- **`apps/admin` is a Next.js app mirroring `apps/web`** (App Router, own Dockerfile/tsconfig/next.config,
  `/health` route, `@rogueoak/canopy` theme). Internal port **3002** (web is 3000). CMD `next start -p 3002`.
- **Auth flow = control-plane sets a host-only admin cookie; the admin app reaches control-plane
  same-origin via `/api`.** The admin app has a Next rewrite `/api/:path* -> ${CONTROL_PLANE_URL}/v1/:path*`
  so in dev (no Caddy) the browser still calls `admin-host/api/*` same-origin and the **host-only** admin
  cookie flows; in prod Caddy's admin block intercepts `/api` first (imports the `(api)` snippet). SSR
  gating: a server-side `getAdmin()` (mirrors web's `getViewer`) reads the admin cookie and calls
  `/v1/admin/auth/me`; middleware/layout redirects to `/login` when absent. control-plane is the
  authoritative gate on every `/v1/admin/*` call.
- **Separate admin identity** in control-plane, fully parallel to accounts (NOT reusing the player
  cookie/table - that separation is the point): `admin_accounts` table, `AdminSession` + `AdminSessionStore`
  (Redis prefix `admin_session:`), a **distinct host-only cookie** `branchout_admin_session` (own name;
  `Domain` NEVER set; HttpOnly/Secure/SameSite=Lax), reusing the `PasswordHasher`.
- **Admin login rate-limited** with the `0036` limiter, key `admin-login:<normalizedEmail>` (anchored on
  the admin account).
- **Root admin** reconciled on boot from `ADMIN_ROOT_EMAIL` + `ADMIN_ROOT_PASSWORD` (upsert password);
  no public admin signup.

## Steps

1. **control-plane admin identity** (`apps/control-plane/src/admin/`):
   - `repository.ts` (`AdminAccount`, `AdminAccountRepository`, `PostgresAdminAccountRepository`) +
     `repository.memory.ts`; migration **id 7** `create_admin_accounts` (id, email, email_normalized
     unique, password_hash, created_by nullable, timestamps) appended in `accounts/migrations.ts` group or a
     new `admin/migrations.ts` wired into `src/migrations.ts`.
   - `session.ts` (`AdminSession {id, adminId, createdAt}`) + `session.store.ts` (`AdminSessionStore` Redis
     `admin_session:` prefix, sliding TTL) + memory variant.
   - `service.ts` (`AdminService`: `login`, `createAdmin(byAdminId,...)`, `getById`, `listAdmins`,
     `ensureRootAdmin(email,password)` upsert). Reuse hasher + email validator.
2. **control-plane admin cookie config** (`config.ts`): an `AdminCookieConfig` (name
   `ADMIN_SESSION_COOKIE_NAME` default `branchout_admin_session`, secure, sameSite lax, **no domain**,
   `ADMIN_SESSION_TTL_SECONDS`). Do NOT read `COOKIE_DOMAIN` for admin.
3. **account extensions for the user-management features** (`accounts/`): add `updateInsider(id, bool)` +
   `listAccounts({query, limit, offset})` (search gamerTagNormalized, paginated) to the repo (Postgres +
   memory) and `changeInsider` + `listPlayers` to the service.
4. **admin routes** (`routes/admin.ts`, registered in `app.ts` under `/v1/admin`): `POST /auth/login`
   (limiter + set admin cookie), `POST /auth/logout`, `GET /auth/me`; an `requireAdmin` guard reading the
   admin session; `POST /admins` (create), `GET /users?query=&page=`, `GET /users/:id`,
   `POST /users/:id/insider`. All except login require a valid admin session (401 otherwise).
5. **wire deps** (`app.ts` AppDeps + `index.ts`): build `AdminService`, `AdminSessionStore` (admin redis
   adapter), pass the existing `limiter`; call `ensureRootAdmin` on boot when the env is set.
6. **`apps/admin` Next app**: scaffold from `apps/web` (package.json `@branchout/admin`, Dockerfile port
   3002, tsconfig, next.config with the `/api` rewrite, health route, layout, `lib/admin-session.ts`
   `getAdmin()`, `lib/admin-api.ts`). Pages: `/login`; `/` (redirect to `/users`); `/users` (search +
   pagination); `/users/[id]` (profile + insider toggle); `/admins` (list + create form). Server-side gate
   in middleware/layout. Mobile-usable at 360px. Unit tests (vitest + testing-library) for the gate + a
   page or two.
7. **Caddy** (`deploy/docker/Caddyfile`): add an `admin.branchout.games` block - `import site_base`,
   `import api` (the `0038` shared control-plane snippet, no `/ws`), and a catch-all `reverse_proxy` to the
   `admin` dynamic upstream (port 3002). Fix the header comment (admin is a Next.js service, not static).
8. **compose + deploy**: `compose.site.yml` add the `admin` service (GHCR image, `mem_limit` 320m/`
   mem_reservation` 160m, `expose 3002`, healthcheck, `depends_on control-plane`, `edge` net) as a rollout
   target; `release.yml` add `admin` to the build matrix + the rollout order (`... web admin`).
   `infra/docker-compose.yml` + `override` + `e2e` overlays: add `admin` (build, `ADMIN_PORT` publish,
   `NEXT_PUBLIC_CONTROL_PLANE_URL`/`CONTROL_PLANE_URL`, and `ADMIN_ROOT_EMAIL`/`ADMIN_ROOT_PASSWORD` in the
   e2e overlay for the seeded root). `e2e/lib/stack.ts` add `ADMIN_PORT` (3102).
9. **e2e** (`e2e/tests/admin.spec.ts`): root admin logs in -> creates an admin -> that admin logs in ->
   views users -> opens a user -> grants insider -> that user sees the insiders surface; boundary negatives
   (a player session gets no admin access; unauthenticated `/api/admin/*` -> 401/redirect; admin login is
   rate-limited). Register in `playwright.config.ts`.
10. **docs**: `overview/architecture.md` (admin service + identity + rollout/capacity), `overview/features.md`
    (admin console), `deploy/README.md` (admin service, DNS `admin` A record, root-admin bootstrap env -
    mechanism only, no values).

## Verification (before commit)

- `pnpm --filter @branchout/control-plane test`, `@branchout/admin test`, `@branchout/web test`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.
- `caddy validate` on the Caddyfile.
- `pnpm e2e` (admin spec) against the compose stack (admin service built + seeded root admin).
