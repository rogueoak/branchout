# 0048 - Host in-game feedback

## Problem

A host running a game is the person who feels every rough edge first: a confusing control, a
piece that lands wrong, a round that stalls. Today there is no way to say so from inside the game -
the host has to remember it, leave, and find some other channel. Feedback that has to survive a
context switch mostly does not get sent. Give the host a one-tap way to report from wherever they
are in the game, with enough context attached that the note is actionable without a back-and-forth.

For: the host of a live game (the tester surface especially, but every host).

## Outcome

- While a game runs, the host sees a "Feedback" affordance right-aligned in the host-controls row.
- Tapping it opens a dialog (a centred modal on desktop, a bottom sheet on a phone) with a short
  intro and a required message field.
- Submitting sends an email to `branchout@rogueoak.com` from `branchout@rogueoak.com` (a
  self-notification) via Resend, carrying the message plus auto-captured context (room code, selected
  game id, current phase, that the sender is the host, and a timestamp). The host never types the
  context.
- The email is a styled, mobile-first HTML body (the brand dark card, modelled on the welcome email)
  with a plain-text fallback. Its subject is `Branch Out Games: Feedback on <Game Name>` (the game id
  humanised to a friendly title), and it names the submitter with their gamer tag and account email
  in a "reach out" block - including a `mailto:` link - so the recipient can follow up directly. An
  anonymous sender (no account) is named by their session display name with no email.
- The dialog shows submitting / success / error states; on success it thanks the host and closes.
- With `RESEND_API_KEY` unset the endpoint returns a clear "not configured" response (503), logs a
  warning, and does not crash - so the code ships now and the secret is wired later.
- Works and looks right at 360px; copy is ASCII-only in the repo voice; the dialog is accessible
  (focus trap, labelled controls, Escape to close - inherited from canopy's `ResponsiveDialog`).

## Scope

In:
- A `Feedback` button in `GameStage`'s host-controls row, host-only, right-aligned.
- A `FeedbackDialog` web component built on canopy's `ResponsiveDialog` (verified exported from
  `@rogueoak/canopy/branches`).
- A `POST /v1/feedback` control-plane endpoint: validate, rate-limit per IP, send via Resend.
- Env plumbing for `RESEND_API_KEY`, `FEEDBACK_MAX_PER_IP`, `FEEDBACK_WINDOW_SECONDS` (env.example,
  config schema, compose, release workflow) - built now, wired (the real key) later.
- Component + integration tests.

Out:
- A general feedback channel for non-host players or outside a game (host-only, in-game only).
- Storing feedback anywhere but the email (no DB table, no ticket system).
- A reply/threading flow. The email is one-way.
- Attachments / screenshots.

## Approach

**Web.** `GameStage`'s `HostControls` row becomes `justify-between`: the existing Advance/Pause/
Restart/Exit stay left, a `FeedbackDialog` trigger sits at the right edge (`ml-auto` on a wrapper so
the row still wraps gracefully at 360px). `GameStage` already knows `isHost`, the game id, and the
game state (phase); `RoomClient` passes the room `code` down. The dialog auto-captures
`{ code, game, phase, isHost, at }` and POSTs `{ message, context }` to `/v1/feedback` through the
same `room-api` fetch base. It uses `ResponsiveDialog*` from `@rogueoak/canopy/branches` so it is a
modal on desktop and a bottom sheet on a phone with no extra work; the message `textarea` is
required and the Submit button reflects idle/submitting/success/error.

**Control-plane.** `registerFeedbackRoutes(app, deps)` mounts `POST /feedback` inside the existing
`/v1` block in `app.ts` (same shape as `registerAuthRoutes`). It is browser-facing and
cookie-authenticated like the room routes. It:
- **requires a valid session** (the same cookie read the room routes use) - `401` otherwise, so an
  anonymous internet caller cannot make the service spend money on Resend or spam the inbox (the
  per-IP cap is only trustworthy behind Caddy, spec 0038);
- **verifies the caller is the host** of the room named in `context.code` by reusing
  `rooms.resume(code, session)` (which re-seats a durable host and rejects a non-member) - a
  non-host or non-member gets `403`, so `isHost` is server-verified, not trusted from the body. When
  the context has no `code`, an authenticated session is the minimum;
- validates the message (non-empty after trim, capped at 5000 chars) - 400 otherwise; each untrusted
  context string (code/game/phase/at) is sliced to 200 chars so it cannot balloon the email;
- rate-limits per client IP using the existing `RateLimiter` (`feedback:<ip>`, tunable
  `FEEDBACK_MAX_PER_IP` / `FEEDBACK_WINDOW_SECONDS`, defaults 5 / 600s), returning 429 +
  `Retry-After` when over, and **records the hit on every processed path** (503/502 included) so no
  path is unlimited;
- if `RESEND_API_KEY` is unset, returns `503 { ok:false, error:'Feedback email is not configured
  yet.' }` and logs a warning - never a crash (the "wire the secret later" behavior);
- otherwise composes both a plain-text body and a styled HTML body (`feedback/render.ts`: message +
  submitter contact + context; every untrusted value HTML-escaped) and sends via Resend. The send is a
  direct `fetch` to `https://api.resend.com/emails` (no new dependency, with a ~10s abort timeout so a
  hung Resend cannot hang the request), injected as a `FeedbackMailer` so tests mock it and assert the
  `from`/`to` and that the body includes the message + context. The submitter's gamer tag + email come
  from a narrow `AccountService.contactById` lookup (server-side only; never returned to a browser),
  falling back to the session display name when there is no account.

The from/to addresses live in one small const module (`feedback/addresses.ts`) so they are not
scattered literals. Success is `{ ok: true }`.

Key decisions / trade-offs:
- **Authenticated + host-verified, not open.** The endpoint spends money (Resend) and writes to a
  human inbox, so it is not anonymous. The host is always signed in and the browser already sends the
  session cookie; verifying host-of-the-room reuses `rooms.resume` (no new code path) and makes the
  reported `isHost` trustworthy.
- **Direct fetch over the `resend` npm package.** Avoids a new dependency for one POST; the mailer
  is an injectable interface so the network call is faked in tests, mirroring the repo's in-memory
  fake style.
- **Reuse `RateLimiter`** rather than add a new limiter - same store-plus-fake shape the auth routes
  use. Authentication is the primary gate; the IP cap is defence-in-depth (best-effort behind Caddy).
- **No persistence.** Email is the delivery; a DB table is out of scope until volume warrants it.

## Acceptance

- [ ] Host-controls row shows a right-aligned "Feedback" button only when `isHost`; it does not
      overflow at 360px.
- [ ] The dialog requires a message, disables Submit while empty/submitting, shows success then
      closes, and shows an error on failure.
- [ ] `POST /v1/feedback` as the host with a valid message and the key set sends via Resend (mocked):
      asserts `from: branchout@rogueoak.com`, `to: branchout@rogueoak.com`, the subject
      `Branch Out Games: Feedback on <Game>`, and both a text and an HTML body containing the message,
      the submitter's gamer tag + email, and the context (room code, game id, phase, host, timestamp).
- [ ] No session -> 401 (and no send).
- [ ] A signed-in non-host of the named room -> 403 (and no send), even if the body claims
      `isHost: true`.
- [ ] Empty message -> 400; message over 5000 chars -> 400.
- [ ] `RESEND_API_KEY` unset -> 503 `{ ok:false, error:'Feedback email is not configured yet.' }`,
      a logged warning, no crash.
- [ ] Over the per-IP limit -> 429 with `Retry-After`, on every processed path (503 included).
- [ ] `RESEND_API_KEY`, `FEEDBACK_MAX_PER_IP`, `FEEDBACK_WINDOW_SECONDS` are in env.example, the
      control-plane config, compose, and release.yml.
- [ ] `pnpm build && typecheck && lint && format:check && test` are green.

## Operator follow-up

Feedback email is inert until an operator sets `RESEND_API_KEY` in the deploy secrets, and
`rogueoak.com` must be verified as a Resend sending domain so `branchout@rogueoak.com` can send.
Until then the endpoint returns "Feedback email is not configured yet." and the host sees that
message rather than a crash.
