# 0029 - Skip the create step on a game deep link; add a Join nav link

Implements the REVISED spec `docs/specs/0029-room-create-pick-invite-flow.md` (front-door
consolidation, 2026-07-18): a `?game=<slug>` deep link skips the "Create a room" tap and lands the
host straight in the lobby, and the top nav gains a "Join" link to `/join`.

## Steps

1. **Auto-create on the deep link** - `apps/web/app/rooms/RoomsHome.tsx`
   - Resolve the deep-link game once with `useMemo` (`preselected`), keeping the insider surface gate
     (an insider slug only pre-selects on the insider surface; dropped on the apex).
   - Extract the create sequence into `runCreate(useReplace)` (the old `onCreate` body). It creates
     the room, selects the pre-selected game, remembers membership, refines the mode, then navigates:
     `router.replace` when `useReplace` (deep link) so the created-room URL supersedes the `?game=`
     URL; `router.push` for the manual button.
   - `onCreate = () => runCreate(false)` for the "Create a room" button (unchanged behaviour).
   - A one-shot `useRef` guard (`autoStarted`) fires the auto-create exactly once per arrival when a
     valid `preselected` game is present AND identity resolves to an account (`isAccount === true`),
     via an effect keyed on `[preselected, isAccount]` - no double-create under re-render/StrictMode.
   - `showSetup` (derived: `preselected && !error && isAccount !== false`) renders a lightweight
     "Setting up your room..." state for an eligible host instead of flashing the landing; an error
     drops back to the create landing with the message; a cannot-host viewer sees the landing.
2. **Join nav link** - `apps/web/components/TopNav.tsx`
   - Add a relative `/join` link beside "Games", matching the adjacent link's classes/a11y. Surface-
     owned (NOT crossed via `toApex`), so the insider host's middleware rewrites it into the insider
     join tree (feedback `0030`). Present for signed-in and signed-out (it sits in the shared left
     group, before the auth-dependent right group).
3. **Tests**
   - `apps/web/app/rooms/RoomsHome.test.tsx` - add `replace` to the router mock; rewrite the deep-link
     cases to assert auto-create + `replace` with no "Create a room" tap; add the one-shot guard test
     (create called once across re-renders), the cannot-host case (no auto-create, landing shown),
     and the failure fallback (alert + landing, no navigation). No-game and insider-apex-ignore cases
     keep the manual button path.
   - `apps/web/components/TopNav.test.tsx` - Join link renders `/join` for signed-out and signed-in,
     and stays relative on the insider surface.
   - `e2e/tests/mobile-smoke.spec.ts` - deep-link auto-create lands directly in the lobby (no Create
     tap, no pick step) and a refresh does not create a second room; the Join nav link reaches
     `/join`; the signed-out nav exposes the Join link.
4. **Docs** - update `docs/overview/features.md` (room-flow + top-nav bullets).

## Verification

- `pnpm --filter @branchout/brand build` (brand dep), then `pnpm --filter @branchout/web... build`.
- `pnpm --filter @branchout/web lint` - clean.
- `pnpm --filter @branchout/web test` - 739 passing.
- `pnpm --filter @branchout/e2e typecheck` + `lint` - clean. The Playwright run needs the Docker
  stack (not runnable in this environment); the assertions were added and typecheck/lint clean.

## Notes / constraints held

- Control-plane endpoints and gates unchanged; `room-api.ts` stays transport only.
- The Join link is relative/surface-owned - no absolute cross-subdomain redirect (redirect-loop risk,
  learnings). The one-shot ref guard avoids the StrictMode double-create.
