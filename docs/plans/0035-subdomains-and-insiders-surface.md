# Plan 0035 - Subdomains + the insiders surface

Source spec: `docs/specs/0035-subdomains-and-insiders-surface.md`. Built on branch
`feat/0035-subdomains-insiders` (worktree). Sequenced after `0034`.

## Design decisions (from exploration)

- **Subdomain detection = `host.startsWith('insiders.')`** - works for `insiders.branchout.games` and
  `insiders.localhost:PORT` alike, which makes the middleware testable in e2e (`*.localhost` resolves
  to 127.0.0.1). Everything else (apex, `www`) is the main site.
- **Middleware routes; the insiders layout authorizes.** Middleware (edge) rewrites the `insiders`
  host into `/insiders*` and does a cheap guard (no session cookie -> redirect to the **apex** login,
  built by stripping the `insiders.` prefix so we don't redirect back into the gated tree). The
  insiders `layout.tsx` is the **authoritative** gate: `getViewer()` -> not signed in -> `/login`; not
  insider -> `forbidden()` (Next 15.1 `experimental.authInterrupts`) for a real, styled **403**.
- **Insider role** is a boolean column on `accounts` (migration id **6** - next free across all
  domains: accounts 1/4, rooms 2, credits 3, profiles 5). Surfaced through `PublicAccount` ->
  `/auth/me` -> web `Viewer.insider`. Granting is a manual DB update until `0037`.
- **Cookie scope**: add optional `domain` to `SessionCookieConfig` (`COOKIE_DOMAIN`). Prod sets
  `.branchout.games`; dev/host-only leaves it unset. E2e sets `COOKIE_DOMAIN=localhost` so one login at
  `localhost:PORT` is sent to `insiders.localhost:PORT`.
- **Badge**: optional `label` prop on `TopNav` renders a small pill on the right.

## Steps

1. **control-plane: insider role (data + read path)**
   - `accounts/migrations.ts`: append `{ id: 6, name: 'add_account_insider', sql: ALTER TABLE accounts ADD COLUMN IF NOT EXISTS insider boolean NOT NULL DEFAULT false }`.
   - `accounts/repository.ts`: add `insider: boolean` to `Account`; map the column in
     `PostgresAccountRepository` row->object (all read methods) and default it in
     `repository.memory.ts`.
   - `accounts/service.ts`: add `insider` to `PublicAccount` and `toPublic`.
   - Tests: extend account repo/service unit tests to assert `insider` defaults false and round-trips.

2. **control-plane: cookie domain**
   - `config.ts`: add `domain?: string` to `SessionCookieConfig`; read `COOKIE_DOMAIN` (unset -> omit).
   - `routes/auth.ts`: include `domain` in `cookieOptions` and in `clearCookie` when set.
   - Test: `config.test.ts` covers `COOKIE_DOMAIN` set/unset.

3. **web: viewer carries insider**
   - `lib/session.ts`: add `insider?: boolean` to `Viewer`; parse `data.account.insider`.
   - Test: `session.test.ts` asserts insider maps through.

4. **web: middleware**
   - `apps/web/middleware.ts` (new): host-aware routing per the design above; `matcher` excludes
     `api`, `_next`, `ingest`, and files with an extension.
   - Test: `middleware.test.ts` unit-tests label detection, rewrite target, apex-404, and the
     apex-login redirect host.

5. **web: insiders tree + badge + 403 boundary**
   - `next.config.mjs`: `experimental: { authInterrupts: true }` (keep existing rewrites).
   - `app/insiders/layout.tsx`: authoritative gate (getViewer -> login / forbidden).
   - `app/insiders/page.tsx` + `InsidersHome.tsx` (client): index of insider games with an **empty
     state**, main look/feel, `<TopNav viewer={viewer} label="Insiders" />`; mobile-first at 360px.
   - `app/forbidden.tsx`: styled 403 boundary.
   - `components/TopNav.tsx`: optional `label` prop -> right-side pill.
   - Tests: `InsidersHome.test.tsx` (empty state + badge render); `TopNav` label test.

6. **Caddy**
   - `deploy/docker/Caddyfile`: extract the `/api` + `/ws` dynamic-upstream blocks into a reusable
     `(api_ws)` snippet; `import` it in the existing apex block; add an `insiders.branchout.games`
     block (`import api_ws` + `handle` -> `web:3000`, `encode`, HSTS). Validate with `caddy validate`.

7. **e2e**
   - `infra/docker-compose.e2e.yml`: add `COOKIE_DOMAIN: localhost` to control-plane.
   - `e2e/lib/stack.ts`: export `grantInsider(gamerTag)` running `docker compose exec -T postgres psql`
     UPDATE against the e2e DB (the documented "manual DB update").
   - `e2e/tests/insiders.spec.ts` (chromium + a mobile-chrome check): insider sees the surface;
     signed-out -> apex login; signed-in non-insider -> 403; apex 404s `/insiders`. Register in
     `playwright.config.ts` testMatch.

8. **docs (reflect, step 6)**
   - `overview/architecture.md`: host-aware routing, the `insider` role, the cookie-domain scope, the
     apex-cannot-reach rule.
   - `overview/features.md`: the insiders surface.
   - `deploy/README.md`: the `insiders` DNS A record + Caddy block.

## Verification (before commit)

- `pnpm --filter @branchout/control-plane test`, `@branchout/web test` (units green).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.
- `caddy validate` on the Caddyfile (via the proxy image or a local caddy).
- `pnpm e2e` (or the insiders spec) green against the compose stack.
</content>
