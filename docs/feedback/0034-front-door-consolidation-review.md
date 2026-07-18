# 0034 - Front-door consolidation: persona-review findings

The front-door epic (specs `0065` unified card, `0030` feature-page rework + insider per-game pages,
`0029` skip-create + Join nav, `0066` join-name autofill) shipped across four PRs (#136-#139). Persona
review caught several major/blocker issues before merge. Capturing the ones that generalize.

## Symptom

- **A one-shot guard "tested" by a non-discriminating test.** The `RoomsHome` auto-create effect has a
  `useRef` guard so it fires exactly once. Its unit test rerendered with identical props and asserted
  `createRoom` was called once - but deleting the guard kept the test green, because the effect's deps
  (`[preselected, isAccount]`) never changed on an identical rerender, so the effect never re-fired with
  or without the guard. The headline "create fires exactly once" guarantee had no test that fails on
  regression. (PR #138, tester, `[major]`.)
- **A refresh/idempotency e2e that never exercised the risk.** The "a refresh must not create a second
  room" e2e called `page.reload()` after the auto-create - but by then `router.replace` had already
  swapped the URL to `/rooms/CODE`, so the reload just reloaded the lobby; `RoomsHome` never re-mounted.
  The test passed even with the guard deleted or `replace` swapped for `push`. (PR #138, tester,
  `[major]`.)
- **Consolidating a shared component left the surface e2e red.** The unified `GameCard` (spec `0065`)
  replaced the old whole-card "Learn about <game>" link with a "Play now" button + a "Details" link, but
  two existing e2e specs (`game-library.spec.ts`, `mobile-smoke.spec.ts`) still asserted the old
  `/learn about .../i` link and were now red, not ported. (PR #137, tester, `[blocker]`.)
- **A card linked to a route that did not exist yet on its surface.** The unified card defaulted
  `showDetails` on, so insider landing cards rendered a "Details" link to `/games/<slug>` - which 404s
  on the insider surface (the insider per-game page did not exist until spec `0030`) and `notFound()`s
  on the apex. The link shipped ahead of its target. (PR #137, engineer, `[major]`.)

## Root cause

- A test named for a *guard* / *one-shot* / *idempotency* guarantee asserted the observable output of
  the happy path, not the mechanism: it never constructed the second invocation the guard defends
  against, so the guard was free to be deleted with the suite still green.
- When a shared component is consolidated, the tests that pin the *old* markup live on other surfaces
  (the e2e that drove the real page), not next to the component - so a green unit suite hides a red e2e.
- An outbound link and the route it targets are two halves of one change; adding the link in an earlier
  PR than its target leaves a dead link on the surface in between.

## Fix

- Rewrote the once-test to force the effect to re-fire (rerender with a *different* valid game slug so
  `preselected` changes) and asserted `createRoom` is still called once - confirmed by mutation that
  removing the guard turns it red. Rewrote the e2e to navigate *back* after the auto-create (from a real
  prior history entry) and assert no second room is minted, which `router.replace` prevents and a `push`
  regression would fail.
- Ported both e2e specs to the new card markup (`Details about <name>`) and kept the 360px overflow
  guard on the reworked page.
- Set `showDetails={false}` on insider cards until the insider per-game page shipped (spec `0030`),
  re-enabling it in the same PR that added the target.

## Learning

Rolled into `overview/learnings.md`:

- **A test named for a guard/one-shot/idempotency invariant must construct the second invocation the
  guard defends against - not just rerender the happy path.** If deleting the guard leaves the test
  green, the test pins nothing. For a React effect guard, change the effect's dependency (not the props
  as a whole) so the effect actually re-runs; mutation-test it (remove the guard, watch it go red).
- **Consolidating a shared component means porting the tests on every surface that asserted the old
  markup - especially the e2e.** A green unit suite for the new component hides a red e2e that still
  drives the old whole-card link; grep the e2e for the strings the old component emitted before merging.
- **Ship an outbound link and the route it targets together, or gate the link.** A "Details"/"Learn
  more" link added ahead of its destination is a dead end on the surface in between; hide it (a
  `showDetails={false}` stopgap) until the target route exists, and re-enable it in the PR that adds the
  target.
