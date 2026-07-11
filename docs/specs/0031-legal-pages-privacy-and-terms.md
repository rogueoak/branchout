# 0031 - Legal pages: privacy policy and terms of service

## Problem

Branch Out has no privacy policy and no terms of service. We are about to add analytics (PostHog,
spec `0032`) and we run accounts, so we want to be preemptive and honest about what we collect, and
we need a terms page that sets expectations: the service is provided as-is with no warranty, and the
terms can change. Neither page exists, and there is no footer path to them.

## Outcome

- A **`/privacy`** page in plain language describing what Branch Out collects and why: **first-party
  PostHog** product analytics (spec `0032`) - all data is first-party (proxied through our own
  domain, no third-party ad/tracking cookies), what accounts store (email, gamer tag, nickname,
  avatar, stars/play history), IP/server logs, data processors, and the visitor's choices/rights.
- A **`/terms`** page: acceptance of terms, eligibility, accounts and acceptable use, that the
  service is **provided "as is" with no warranty** and a limitation of liability, that **the terms
  can change at any time** (with the last-updated date and continued-use-is-acceptance), IP/ownership,
  and termination. Researched against common SaaS ToS structure (we are not lawyers - this is a
  good-faith, plain-language draft, not legal advice, and says so).
- Both pages are **linked from the footer** (and included in the sitemap, spec `0030`), carry a
  **"Last updated"** date, and read well on mobile.
- Covered by tests: both routes render, expose the key clauses, and the footer links resolve.

## Scope

In:

- **`/privacy`** (`app/privacy/page.tsx`) - adapted from the plain-language structure of the
  `../matthewmaynes` privacy page, rewritten for Branch Out: a short version, an **Analytics**
  section describing first-party PostHog (product analytics, error/crash reporting, that it is
  first-party and cookieless-where-possible, session behavior), **Accounts and what we store**
  (email, gamer tag, nickname, avatar, stars and recent plays), **anonymous play** (ephemeral
  sessions), **IP addresses and server logs**, **data processors** (PostHog - US), **children**,
  **your choices and rights**, **changes**, and a **contact** address. Accurate to what the product
  actually does today (accounts + rooms + the incoming analytics).
- **`/terms`** (`app/terms/page.tsx`) - acceptance, eligibility (not directed at children under the
  applicable age), account responsibilities and acceptable use (no cheating/abuse/harassment), user
  content (the nicknames/answers players submit), **IP and ownership**, **disclaimer of warranties
  ("as is")**, **limitation of liability**, **changes to the terms (any time; continued use =
  acceptance)**, **termination**, governing law placeholder, and contact. Plain language; an explicit
  "not legal advice" note.
- A shared **footer** (or extend the existing landing footer) with Privacy and Terms links, used on
  the marketing and rooms/join surfaces; both pages render the top nav (spec `0028`).
- A single source for the **contact email** and **last-updated date** constants so they are not
  duplicated across the two pages.
- Sitemap entries for `/privacy` and `/terms` are added in spec `0030`; this spec ensures the routes
  exist for it.

Out:

- Legal review or bespoke jurisdiction-specific clauses - this is a good-faith plain-language draft;
  a real review is a separate, non-engineering task. The governing-law/entity details are
  placeholders to fill in.
- A cookie-consent banner or granular consent management - the analytics are first-party and
  described in the policy; if a jurisdiction later requires a banner, that is its own spec.
- A DPA, subprocessor list page, or account-data export/delete tooling - the policy states the right;
  the self-service tooling is future work.
- The PostHog integration itself (spec `0032`) - this spec only *describes* it accurately.

## Approach

- **Borrow structure, not text.** The `../matthewmaynes` privacy page is a good plain-language
  skeleton (short version, analytics, logs, choices, changes, contact); reuse the shape but rewrite
  every section for Branch Out's actual surface (we have accounts and rooms; that site did not).
  Do not copy claims that are false here (e.g. "no account, no login").
- **Describe what is true, including what is coming.** Analytics is first-party PostHog (spec `0032`)
  - say so plainly: product analytics + error reporting, first-party (proxied through our own
  domain), and what it does and does not do. Keep the copy in step with the actual `0032`
  implementation (e.g. whether session replay is on).
- **Terms research, plainly written.** Model the ToS on the common SaaS sections (acceptance,
  eligibility, accounts/acceptable use, user content, IP, warranty disclaimer, liability limit,
  changes, termination, governing law, contact) but keep every clause short and readable per the
  Trellis language rules, with a visible "not legal advice / we can change these" framing the user
  asked for.
- **Constants over duplication.** Contact email and the last-updated date live in one module each
  page imports, so an update touches one place.
- **Static, fast, mobile-first, ASCII-only.** Both are static server components using canopy typography
  tokens; they read cleanly at 360px.

## Acceptance

- [ ] `/privacy` renders the plain-language policy accurate to Branch Out: first-party PostHog
      analytics, what accounts store, anonymous play, IP/logs, processors, children, rights, changes,
      contact - with a Last updated date.
- [ ] `/terms` renders acceptance, eligibility, accounts/acceptable use, user content, IP, an "as is"
      **no-warranty** disclaimer, a liability limit, a **terms-can-change-any-time** clause, and
      termination - with a Last updated date and a "not legal advice" note.
- [ ] The footer links to both pages from the marketing and rooms/join surfaces, and both pages carry
      the top nav (spec `0028`); links resolve.
- [ ] Contact email and last-updated date come from a single constant each, not duplicated strings.
- [ ] Both pages read well at 360px.
- [ ] Tests assert both routes render, expose the key clauses (no-warranty, terms-can-change,
      first-party analytics), and the footer links resolve.
</content>
