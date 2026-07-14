# 0047 - Newsletter subscribe

## Problem

Branch Out has no way for a visitor to say "tell me when there's more". The `/games` page lists the
games that exist today, but the roadmap has more coming and an interested player has no path to hear
about them. We want a low-friction email capture that feeds a real mailing list (Constant Contact's
"Branch Out" list) so we can reach interested players when a new game ships, without standing up a
bespoke email pipeline.

The sibling rogueoak site already solved this against Constant Contact (CTCT): a pure, unit-tested
core that validates an email, exchanges a long-lived OAuth refresh token for a short-lived access
token (cached, self-healing on a stale-token 401), and posts the contact to a `sign_up_form`. We port
that flow into branchout.

Who it's for: prospective and returning players browsing `/games`.

## Outcome

- `POST /v1/subscribe` (reachable in prod at `/api/v1/subscribe`; Caddy strips `/api`) adds a
  visitor's email to the CTCT "Branch Out" list and returns `{ ok: true }`.
- The endpoint is **inert until secrets are provisioned**: with any of `CTCT_CLIENT_ID`,
  `CTCT_REFRESH_TOKEN`, `CTCT_LIST_ID` unset it returns `503 { ok: false, error: 'Subscribe is not
  configured yet.' }` and logs a warning - it never crashes and never 500s for a missing config.
- The `/games` page shows a "More games coming soon" banner with a "Subscribe for updates" button
  that reveals an on-theme, mobile-first subscribe form. Submitting posts the email to the endpoint
  and shows a success or error state inline.
- Failures return generic messages; a subscriber's email is never echoed back in a response or a log.
- Naive bots are dropped by a hidden honeypot (`company`) field, and the endpoint is rate-limited per
  client IP.

## Scope

**In**

- The pure CTCT core in `apps/control-plane/src/subscribe/` (token cache/refresh/self-heal,
  `sign_up_form` contact create, email validation) - injectable `fetch` + clock, unit-tested.
- The route module `apps/control-plane/src/routes/subscribe.ts` (`registerSubscribeRoutes`),
  registered inside the existing `/v1` block in `app.ts`.
- Per-IP rate limiting via the existing spec 0036 `RateLimiter`; honeypot; small body cap.
- Env plumbing for `CTCT_CLIENT_ID`/`CTCT_REFRESH_TOKEN`/`CTCT_LIST_ID` plus tunable
  `SUBSCRIBE_MAX_PER_IP`/`SUBSCRIBE_WINDOW_SECONDS` (defaults 5 / 600) across the config schema,
  `infra/.env.example`, `compose.site.yml`, and `release.yml`.
- The web `SubscribeForm` client component and the `/games` coming-soon banner that opens it.
- Unit tests (core), integration tests (endpoint via Fastify `inject`), and a component test.

**Out**

- Real CTCT secret values (an operator provisions these later; see Operator follow-up below).
- A dedicated `/subscribe` page (rogueoak has one; branchout only needs the `/games` banner for now).
- Analytics events for the subscribe funnel (a follow-up; the endpoint and form ship first).
- Double opt-in / welcome-email customization (CTCT's `sign_up_form` opt-in is used as-is).

## Approach

**Where it lives.** Unlike rogueoak (a single Next app that owns the route and the secrets), branchout
has a Fastify control-plane that owns `/api` routes and holds server secrets. The endpoint goes there,
NOT in the Next app - the browser never sees the CTCT credentials.

**Pure core** (`subscribe/constant-contact.ts` + `subscribe/validate.ts`), mirroring rogueoak:

- `validateSubscribe` reuses the account `normalizeEmail`/`validateEmail` shape check (both use the
  same permissive `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), trims + caps an optional name, and drops the CTCT
  `sign_up_form` first/last-name split. Email is required; name is optional.
- `createTokenCache(now)` mints an access token once and reuses it until `expires_in - 60s`, sharing a
  single in-flight refresh across a cold-cache burst.
- `submitSubscription` runs the write behind `withFreshTokenRetry`: on a stale-token 401 it clears the
  cache, mints a fresh token, and retries the `sign_up_form` write exactly once.
- `fetch` and `now` are injected (the codebase's dependency-injection style) so the network and clock
  are mocked in tests. Errors carry only an HTTP status, never the CTCT response body (which can echo
  the submitted email) - so nothing PII lands in logs.

**Route** (`registerSubscribeRoutes(app, deps)`), following `registerAuthRoutes`:

1. Read the JSON body; drop a request whose serialized body exceeds a small cap (8 KB).
2. Honeypot: a filled `company` field returns `{ ok: true }` silently (the bot learns nothing).
3. Validate + normalize the email (400 on failure, generic message).
4. Rate limit per `request.ip` using `deps.limiter` (spec 0036), keyed `subscribe:<ip>`; over the
   limit returns `429` with `Retry-After`.
5. Read `CTCT_*` from `deps.config`. Any unset -> `503 { ok:false, error:'Subscribe is not configured
   yet.' }` + a `warn` log. This is the "wire secrets later" behavior.
6. `submitSubscription` -> `{ ok: true }`. Any CTCT failure -> a generic `502`/`500`, never the
   upstream body.

The route is registered in `app.ts` inside the `/v1` child context next to `registerAuthRoutes`, and
its deps (config + the shared limiter + a module-scoped token cache) are wired in `index.ts`.

**Config.** `loadConfig` gains an optional `subscribe` block: the three `CTCT_*` strings (each optional
so a missing one is detectable, not a boot-time throw) and the two tunable rate-limit knobs (parsed
through the existing `parsePositiveInt` guard so a garbage value falls back to the default, never
`NaN`).

**Web.** Branchout's canopy version does NOT export a `SubscribeForm` (rogueoak imports it from
`@rogueoak/canopy/branches`; branchout's `branches` export has no such component), so we build a small
on-theme form from canopy `Input`/`Label`/`Button` - mobile-first, good at 360px, an accessible label,
a hidden honeypot, and success/error states. It posts `{ email, name?, company }` to
`${NEXT_PUBLIC_CONTROL_PLANE_URL}${V1_PREFIX}/subscribe` (the same relative `/api` base the rest of the
browser code uses via `room-api.ts`). The `/games` banner is a tasteful "More games coming soon" strip
with a button that reveals the form.

## Acceptance

- [ ] `POST /v1/subscribe` with a valid email and all `CTCT_*` set posts a `sign_up_form` body whose
      `list_memberships` includes the configured list id and `create_source` is `"Contact"`, and
      returns `{ ok: true }` (integration test, CTCT fetch mocked).
- [ ] An invalid email returns 400 with a generic message and makes no CTCT call.
- [ ] A filled honeypot (`company`) returns `{ ok: true }` and makes no CTCT call.
- [ ] With any `CTCT_*` unset, the endpoint returns `503 { ok:false, error:'Subscribe is not
      configured yet.' }` and logs a warning (no crash, no 500).
- [ ] Over the per-IP limit returns `429`.
- [ ] Unit: the token cache reuses a live token and self-heals once on a 401 (a fresh mint + retry).
- [ ] The `/games` page renders the coming-soon banner with a "Subscribe for updates" button that
      reveals the form; the form submits success and error states (component test).
- [ ] `CTCT_CLIENT_ID`/`CTCT_REFRESH_TOKEN`/`CTCT_LIST_ID` + `SUBSCRIBE_MAX_PER_IP`/
      `SUBSCRIBE_WINDOW_SECONDS` are plumbed through `infra/.env.example`, `compose.site.yml`, and
      `release.yml`.
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` all green.

## Operator follow-up (wire secrets later)

The endpoint ships inert. To turn it on, an operator provisions the three CTCT secrets and sets them
as GitHub Actions secrets (`release.yml` writes them into `.env.prod`):

- `CTCT_CLIENT_ID` - the Constant Contact app's client id.
- `CTCT_REFRESH_TOKEN` - minted via the `ctct` CLI: `ctct login` (a long-lived, non-rotating refresh
  token for the account that owns the "Branch Out" list).
- `CTCT_LIST_ID` - the "Branch Out" list's id, found with `ctct list list --name "Branch Out"`.

Optional tunables `SUBSCRIBE_MAX_PER_IP` (default 5) and `SUBSCRIBE_WINDOW_SECONDS` (default 600) set
the per-IP rate limit.

## Abuse / go-live

This endpoint adds an arbitrary third-party email to the "Branch Out" CTCT list. The honeypot and the
per-IP rate limit only deter *naive* bots: a distributed signup-bomb from a proxy pool can still list
victims who never asked to subscribe, which both harms those people and burns our sender reputation
(spam complaints from addresses that never opted in). The endpoint ships **inert** (no CTCT secrets),
so nothing lists anyone until an operator turns it on - which is exactly the moment this must be
handled.

**Required before go-live (a hard gate on provisioning the CTCT secrets):**

- **Enable Confirmed (double) opt-in on the "Branch Out" Constant Contact list.** With confirmed
  opt-in, a `sign_up_form` submission only sends a confirmation email; the address does **not** join
  the list until the recipient clicks the confirmation link. So a signup-bomb can, at worst, cause one
  confirmation email to a victim (annoying but not a subscription, and not counted as an opt-in), and
  our list stays clean of unconfirmed addresses. Do NOT provision `CTCT_CLIENT_ID` /
  `CTCT_REFRESH_TOKEN` / `CTCT_LIST_ID` until confirmed opt-in is on for that list.

**Stronger future hardening (not built now - deliberately deferred to keep this change small):**

- A challenge on the form (CAPTCHA or a proof-of-work token) to blunt automated submissions before
  they ever reach CTCT.
- A **global** rate cap (not just per-IP) on the endpoint, so a distributed attack across many IPs is
  still bounded in total confirmation emails per hour.

The subscribe route carries a short comment at its CTCT-call site pointing at this decision, so the
next reader sees that confirmed opt-in is the accepted mitigation, not an oversight.

