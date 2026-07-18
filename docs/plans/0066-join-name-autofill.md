# Plan 0066 - Join page name autofill + remembered name + random fallback

Source spec: `docs/specs/0066-join-name-autofill.md`. Branch `feat/join-name-autofill`. Web-only; no
control-plane or endpoint changes. The insider join surface (`app/insider/join/page.tsx`) re-exports
the apex join page, so every change applies to both automatically.

## Design decisions

- **Precedence resolved once, after mount.** A client-only `useEffect` in `JoinForm` seeds the name
  field with `recallPlayerName() ?? viewer.gamerTag ?? generateRandomName()`, mirroring the existing
  `recallDeviceMode` mode effect. The SSR render keeps the empty initial `useState('')`, so
  localStorage and `Math.random` never run on the server and there is no hydration mismatch or flash.
- **Generate-once via immediate persist.** When step 3 (generate) runs it calls `rememberPlayerName`
  immediately, so the next visit recalls it via step 1. That makes the "only generate when they have
  nothing" rule hold automatically - a fresh name is minted at most once per browser.
- **localStorage, like device mode.** The remembered name is a cross-visit convenience, so it lives
  in `localStorage` (`branchout:playerName`) beside the device-mode helpers, not the per-tab
  sessionStorage seat state.
- **On-brand generator.** `random-name.ts` pairs a curated adjective with a woodland-critter / bug /
  plant noun ("Prickly Ostrich") to match the avatar set. ASCII, family-friendly, title-cased; the
  longest possible pair is well under the control-plane 40-char display-name limit. Randomness is
  injectable (`rng` param, defaults to `Math.random`) so tests are deterministic.

## Files

- `apps/web/lib/random-name.ts` (new) - `ADJECTIVES`, `NOUNS`, `generateRandomName(rng?)`.
- `apps/web/lib/membership.ts` - added `rememberPlayerName` / `recallPlayerName` (keyed
  `branchout:playerName`, guarded on `typeof window`, trimmed).
- `apps/web/app/join/JoinForm.tsx` - name-seeding effect (precedence above); persist on submit and on
  blur. Field stays editable and required.
- Tests: `apps/web/lib/random-name.test.ts`, `apps/web/lib/membership.test.ts`, extended
  `apps/web/app/join/JoinForm.test.tsx` (seeding precedence). `e2e/lib/helpers.ts` `joinRoom` now
  asserts the field arrives pre-filled before overwriting it.
- Docs: this plan; `docs/overview/features.md` "Game client shell" bullet.

## Verification

- `pnpm --filter @branchout/brand build` (unbuilt workspace dep blocks the web test transform).
- `pnpm --filter @branchout/web test` - 721 passing, including the new generator, membership, and
  seeding-precedence tests.
- `pnpm --filter @branchout/web lint`, `next build` (typecheck + build), all green.
- `prettier --write` on changed files (CI runs `format:check`).

## Steps

1. Add `random-name.ts` generator with injectable rng and length guard.
2. Add `rememberPlayerName` / `recallPlayerName` to `membership.ts`.
3. Seed the name field in `JoinForm` after mount; persist on submit + blur.
4. Unit tests (generator, membership, seeding); extend the join e2e pre-fill assertion.
5. Update `features.md`; run lint + typecheck + test + build; format; commit.
