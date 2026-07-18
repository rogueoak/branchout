# 0035 - Front-door e2e failures blocked the deploy

The front-door epic (specs `0065`/`0030`/`0029`/`0066`) merged to `main` across PRs #136-#140, but the
changes did **not** reach production: the `verify / e2e` job in `release.yml` failed for PR #138, so
its `build` and `deploy` jobs were skipped - and because every release run redeploys `HEAD`, the later
runs (#139, #140) were also blocked. Prod stayed at PR #137 while `main` was four PRs ahead.

## Symptom

`release.yml`'s `verify / e2e` reported `2 failed, 46 passed`:

- **`mobile-smoke.spec.ts` - the Join nav link is untappable at 360px.** `nav.getByRole('link', {name:
  'Join'}).click()` timed out; Playwright reported the "Log in" link "intercepts pointer events" over
  the Join link. The element had a bounding box (so `toBeVisible` passed) but was not *actionable* -
  the nav's left group (wordmark + Games + Join) and right group (Log in + Sign up) overlapped.
- **`insider.spec.ts` - a click on a removed "Create a room" button timed out.** The test tapped an
  insider game card, landed on `/rooms?game=teeter-tower`, then clicked "Create a room" and waited for
  the lobby - but spec `0029` made the `?game=` deep link **auto-create** the room (no button), so the
  button never appeared and the click waited out the 60s timeout.

## Root cause

- **Adding the "Join" link (spec `0029`) pushed the top nav past 360px.** The `Wordmark` text lockup
  was sized for "wordmark + Games + Log in + Sign up" at 360px (a comment even said so) - adding Join
  overflowed it. The left group carries `min-w-0`, so it shrank below its content and its last item
  (Join) overflowed *under* the right group, where "Log in" intercepted the tap. A `toBeVisible` check
  did not catch it because an overlapped element still has a box; only a real `.click()` (actionability)
  does.
- **The auto-create flow change (spec `0029`) removed the "Create a room" step on the `?game=` path,
  but one e2e that drove that path was not updated.** The PR ported `mobile-smoke.spec.ts` but missed
  `insider.spec.ts`, which exercises the same deep-link -> create flow on the insider surface.
- **The e2e is a *deploy* gate, not a required *PR* check.** The PRs merged green on their required
  checks (e2e is not one) but each push then ran `release.yml`, whose `verify / e2e` gates `deploy`. A
  red e2e there silently blocks prod for that push and every later one until it is fixed.

## Fix

- `Wordmark` gains a `collapseTextOnMobile` prop: on the narrowest phones (below ~430px) it renders
  the mark icon-only and hides the "Branch Out games" text (the `aria-label` stays, so a screen reader
  still hears the brand), so the crowded nav fits at 360px without the groups overlapping. `TopNav`
  opts in; standalone pages (not-found, account) keep the full mark. Proven by the 360px nav e2e.
- `insider.spec.ts` updated for the auto-create flow: tap the card, wait for the lobby URL, no button.

## Learning

Rolled into `overview/learnings.md`:

- **Adding an item to a fixed-width nav means re-verifying the 360px *tap*, not just visibility.** An
  overlapped control still has a bounding box, so `toBeVisible` passes while `.click()` fails; drive a
  real tap at 360px. When a horizontal bar can overflow, collapse the biggest element (the wordmark to
  icon-only) below a breakpoint rather than letting a `min-w-0` group overflow under its neighbor.
- **A flow change that removes a step must be reconciled against *every* e2e that drives that flow -
  grep the whole `e2e/` tree for the removed affordance, not just the specs you remember.** A missed
  one fails only in the deploy-gating e2e job, after merge.
- **A red `verify / e2e` in `release.yml` means "not deployed", even though the PR merged.** e2e is a
  deploy gate, not a required PR check, and each release run redeploys `HEAD`, so one red e2e blocks
  that push and every later one. After merging a UI/flow change, watch the release run and treat a red
  e2e there as an undeployed change, not just a flaky test.
