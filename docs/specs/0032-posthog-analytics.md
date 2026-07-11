# 0032 - PostHog product analytics (first-party)

## Problem

We have no analytics, so we cannot see how visitors move through the funnel (landing -> game feature
page -> create room -> invite -> play), where drop-off happens, or when the client is erroring. We
want **PostHog** for product analytics and error tracking, wired so that **all data is first-party**:
requests proxied through our own domain (no third-party tracker hostnames), matching the privacy
posture the policy states (spec `0031`).

The PostHog **project API key** is `phc_pBX9qovQaTG2jHmUhN8uEYCjzHj8GbkAdTZBdz9RXr26` (project id
`507695`). This is a publishable client key (safe in the browser), but it is still supplied via
configuration, not hardcoded, so it can differ per environment and stay out of source where sensible.

## Outcome

- PostHog is initialized in `apps/web` and captures **pageviews** and **key funnel events** (start a
  room, pick a game, invite/share, join a room, start a game, game complete), plus **client error**
  reporting.
- Analytics traffic is **first-party**: the PostHog JS talks to a **same-origin reverse-proxy path**
  (e.g. `/ingest/*` via Next rewrites, or the Caddy edge) that forwards to PostHog, so no third-party
  analytics hostname appears and ad/tracking-blockers that target PostHog's domain do not silently
  drop our first-party product data.
- Analytics run **only in the deployed environment**, not in local dev, tests, or CI (no noise, no
  data from developers).
- A signed-in player is **identified** by a **stable, non-sensitive** id (the gamer tag or account
  id) so funnels can connect a session to a returning player; anonymous visitors stay anonymous.
- The key is read from **configuration** (`NEXT_PUBLIC_POSTHOG_KEY`, host `NEXT_PUBLIC_POSTHOG_HOST`
  / proxy path), documented for local, e2e, and prod.
- Covered by tests: init is gated to production, the proxy path is used (not the raw PostHog host),
  events fire on the key funnel actions, and dev/test capture nothing.

## Scope

In:

- **PostHog web integration** in `apps/web`: add `posthog-js` (and `posthog-node` only if we later
  need server-side capture - out for now), a client provider that initializes PostHog once, in the
  browser, in production only, pointed at the **first-party proxy path**.
- **First-party proxy**: Next.js `rewrites()` mapping a same-origin path (e.g. `/ingest/`) to the
  PostHog ingestion + assets hosts (US cloud), so the browser only ever calls our origin. Confirm it
  composes with the Caddy same-origin routing in prod (spec `0011`); document the path.
- **Event instrumentation** at the funnel seams: pageviews (auto or route-change capture), and
  explicit events for create room, pick game, invite opened / link copied / native share, join,
  start game, and game complete. Keep event names and properties in a **single `analytics.ts`
  module** (typed helpers) so call sites do not hand-write event strings.
- **Identify / reset**: identify a signed-in account by a stable non-sensitive id on login/hydrate;
  `posthog.reset()` on logout so a shared device does not bleed identity across accounts. Never send
  email, password, session id, or answers as properties.
- **Config**: `NEXT_PUBLIC_POSTHOG_KEY` (the project token above) and host/proxy settings, wired
  through the same env plumbing as the other `NEXT_PUBLIC_*` values (`dev`, `dev:lan`, e2e, prod
  compose). Default off when the key is unset.
- **Docs**: note in the deploy/env docs how the key and proxy are configured, and keep the privacy
  policy (spec `0031`) in sync with what is actually captured (e.g. whether session replay is on -
  default **off** unless we decide otherwise here).

Out:

- **Server-side / control-plane / engine analytics** - this spec is web product analytics only; a
  backend capture (e.g. business events from the control-plane) is a later spec if needed.
- **Session replay, heatmaps, feature flags, A/B experiments** - default replay **off** for privacy;
  enabling any of these is a follow-up with its own privacy-policy update.
- **A cookie-consent banner** - first-party, minimal, and described in the policy; if a jurisdiction
  requires consent gating we add it in a dedicated spec.
- Capturing any PII or gameplay content (answers, messages) as event properties.

## Approach

- **First-party by construction.** Point `posthog-js` at a same-origin `api_host` (the rewrite path)
  so every request is to our domain - this is the "first-party" the privacy policy promises and it
  survives third-party-domain blockers. Verify the rewrite forwards both the ingestion and static
  asset paths PostHog needs, and that it sits behind the same Caddy origin in prod.
- **Production-only, config-gated.** Initialize only when `process.env.NODE_ENV === 'production'`
  **and** the key is set, mirroring the `../matthewmaynes` "analytics only on the live site" posture,
  so dev/test/CI never emit. A missing key is a no-op, not a crash.
- **One analytics module, typed events.** Centralize `init`, `identify`, `reset`, and a small set of
  named `capture` helpers with typed payloads in `lib/analytics.ts`; call sites use the helpers, so
  event names stay consistent and are greppable, and tests can assert against the module.
- **Identity is stable and non-sensitive.** Use the gamer tag or account id (already public/stable),
  never the email or session token; `reset()` on logout. This keeps funnels joinable without leaking
  PII into the analytics store.
- **Privacy-policy parity.** Whatever this spec turns on (analytics + error capture; replay off) is
  exactly what spec `0031` describes - the two ship consistent.
- **Mobile-first is unaffected** (analytics is non-visual); ASCII-only in any user-facing copy.

## Acceptance

- [ ] PostHog initializes in `apps/web` in production only, keyed from `NEXT_PUBLIC_POSTHOG_KEY`, and
      is a no-op in dev/test/CI and when the key is unset.
- [ ] All analytics requests go to a **same-origin** proxy path (no third-party PostHog hostname in
      the browser); the rewrite forwards to PostHog and works behind the prod Caddy edge.
- [ ] Pageviews and the funnel events (create room, pick game, invite/copy/share, join, start game,
      game complete) fire from the typed `analytics.ts` helpers at the right seams.
- [ ] A signed-in player is identified by a stable non-sensitive id; `reset()` runs on logout; no
      email/session/PII or gameplay content is ever sent as a property.
- [ ] Session replay is off by default; the privacy policy (spec `0031`) matches what is captured.
- [ ] Config is documented for dev, e2e, and prod; the key/proxy are set via env, not hardcoded.
- [ ] Tests cover production-gating, the proxy host, event firing on the funnel actions, and the
      dev/test no-op.
</content>
