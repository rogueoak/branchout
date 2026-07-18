# 0066 - Join page: auto-filled name, remembered name, and a random fallback

## Problem

On the `/join` page the "pick your name" field starts **empty** (`useState('')`) and the Join button
is disabled until the player types something. That is friction on the fastest, most casual path into
the product - a friend handed a room code, on a phone, one-handed. A signed-in player has a perfectly
good name (their gamer tag) that the form already receives as a prop but ignores. A returning
anonymous player has to retype a name every time. And a brand-new anonymous player faces a blank
required field before they can even join.

We want the name field to **always arrive filled in** with a sensible default, to **remember** what a
player last chose (even without an account), and to **invent a friendly random name** for an anonymous
player who has nothing - so joining is one tap.

## Outcome

- The "pick your name" field is **pre-filled on load** using this precedence:
  1. the **last name the player actually picked (typed)**, if we remembered one - even for an
     anonymous player with no account;
  2. otherwise, for a **signed-in** player, their **gamer tag** (authoritative for their identity);
  3. otherwise (an anonymous player with no picked name and no gamer tag), a **randomly generated
     name** - a friendly adjective + noun like "prickly ostrich" - generated once and then remembered.
- **Two separate storage slots.** The picked name and the generated anonymous default live under
  **distinct localStorage keys** (`branchout:playerName` vs. `branchout:anonName`). Only a name the
  player *typed* is written to the picked slot; the generated default is written only to the anon
  slot. This keeps a signed-in player's gamer tag authoritative: an anonymous name generated before
  sign-in can never shadow the gamer tag afterwards (precedence step 2 still wins), yet a name the
  player deliberately picked still wins for everyone (step 1).
- When the player **edits** the name, that typed value is **saved to the picked slot** (on submit and
  on blur-when-non-empty) and reused as the default on their next visit (any room), account or not.
  The seeded default is **never** written to the picked slot.
- The randomly generated name is **only generated when the player has nothing** (no picked name and
  no gamer tag); once generated it is stored in the anon slot, so the same anonymous player keeps the
  same fun name across visits rather than getting a new one each time.
- The seeding effect is **guarded**: if the field is already non-empty (the player has started
  typing, or a value was already seeded) it does nothing, so it never clobbers an early keystroke or
  re-seeds when `viewer.gamerTag` resolves mid-edit.
- The field is still editable and still required to be non-empty; a player can always overwrite the
  default. Joining works in one tap when the default is acceptable.
- The behavior is identical on the apex and the insider join surface (the insider join re-exports the
  same page), and is mobile-first (no hydration flash, the pre-fill settles client-side).
- Covered by tests: gamer-tag pre-fill for a signed-in player, remembered-name precedence, random-name
  generation-and-persistence for a fresh anonymous player, and edit -> persist -> reuse.

## Scope

**In**

- **Seed the name field** in `apps/web/app/join/JoinForm.tsx` after mount (a client-only effect,
  hydration-safe, mirroring the existing device-mode effect) using the precedence above. The initial
  SSR value stays empty/neutral; the effect fills it so localStorage and randomness never run on the
  server and never cause a hydration mismatch.
- **Two remembered-name localStorage helper pairs** alongside the existing device-mode helpers in
  `apps/web/lib/membership.ts`: `rememberPlayerName(name)` / `recallPlayerName()` (the picked name,
  keyed `branchout:playerName`) and `rememberAnonName(name)` / `recallAnonName()` (the generated
  anonymous default, keyed `branchout:anonName`). Both are guarded on `typeof window` and ignore a
  blank value. Persist the picked name only on a meaningful edit (on submit, and on blur when
  non-empty) so the last name the player *typed* survives; the seeded default is never written to the
  picked key.
- **A random adjective + noun name generator** - a new small pure util (e.g.
  `apps/web/lib/random-name.ts`) with a curated, on-brand, ASCII, family-friendly adjective list and
  noun list (nature/party/critter flavor to match the brand), combining one of each ("prickly
  ostrich"). Pure and unit-testable (inject or seed the randomness so a test is deterministic); the
  generated default is title-cased/displayed consistently and stays within the display-name length
  limit (control-plane `validateDisplayName`, 1-40 chars).
- **Persist the generated name** the first time it is used, so it is stable across visits (generate
  only when there is nothing to recall and no gamer tag).
- Keep the field editable/required; the Join button stays gated on a non-empty trimmed name.
- Unit tests: `random-name` (deterministic under a seed, within length, ASCII, adjective+noun shape),
  the membership remember/recall helper, and `JoinForm` seeding (signed-in gamer tag; remembered name
  wins; fresh anonymous gets a generated-and-persisted name; edit persists and is reused). Extend the
  join e2e happy path to assert the field arrives pre-filled.

**Out**

- Changing the control-plane join/anonymous-session **endpoints** or `validateDisplayName` (the
  generated/typed name flows through them unchanged; the generator just respects the length limit).
- Server-side or cross-device name storage (this is a local convenience, not a profile change; a
  signed-in player's canonical nickname/gamer tag still lives on their account, spec `0027`).
- The **`/join` reachability / nav "Join" link** (spec `0029`) and the room-flow changes.
- Uniqueness/collision handling for random names (two players may generate the same name; the room
  already tolerates duplicate display names).
- Localizing the word lists (English, ASCII only, per Trellis language rules).

## Approach

- **Precedence in one place.** A small resolver - `recallPlayerName() ?? viewer.gamerTag ??
  (recallAnonName() ?? generateAndPersistAnonName())` - computes the default once after mount and sets
  the field. Because the generated name is immediately persisted to the anon slot (and future visits
  recall it), the "only generate when they have nothing" rule holds automatically: the generate branch
  runs at most once per browser. Keeping the generated default in its own slot (never the picked slot)
  is what lets a later sign-in fall through to the authoritative gamer tag.
- **Client-only, hydration-safe.** localStorage and randomness cannot run during SSR (they would
  diverge between server and client), so the field initializes empty on the server and a `useEffect`
  (the same shape the existing `recallDeviceMode` effect uses) fills it on the client - no flash of a
  wrong value, no `Math.random` in render.
- **Reuse the established localStorage pattern.** The device-mode helpers in `membership.ts` are the
  template (guarded, namespaced `branchout:` key); add a sibling name helper rather than inventing a
  new storage convention. Membership seat state stays in `sessionStorage`; the remembered *name* is a
  cross-visit convenience, so it belongs in `localStorage` like device mode.
- **Persist on edit and on the generated default.** Save whenever the player commits a name (submit is
  the reliable point; optionally on blur/change) and when a fresh random name is minted, so the next
  visit recalls it via step 1.
- **On-brand random names.** The word lists lean into the nature/party/critter brand (the avatar set is
  "woodland critters, bugs, and plants") so a generated name feels like it belongs, not like a UUID.
  Keep them ASCII and family-friendly; keep the combined length within the 40-char display limit.
- **Mobile-first.** The default arrives filled so the common path is: open the join link, tap Join.

## Acceptance

- [ ] Opening `/join` pre-fills the name field: a signed-in player sees their gamer tag; a returning
      player (account or not) sees the last name they picked; a fresh anonymous player sees a generated
      adjective+noun name (e.g. "prickly ostrich").
- [ ] Editing the name and joining persists the chosen name to localStorage; revisiting `/join` (any
      room) pre-fills that remembered name, even with no account.
- [ ] The random name is generated **only** when there is no remembered name and no gamer tag, and it
      is persisted on first use so the same anonymous player keeps the same name across visits.
- [ ] The generated name is ASCII, family-friendly, an adjective + noun, and within the display-name
      length limit; the field stays editable and required.
- [ ] Behavior is identical on the apex and insider join surfaces; no hydration mismatch/flash (the
      pre-fill settles client-side).
- [ ] Unit tests cover the generator (deterministic under a seed, shape, length), the remember/recall
      helper, and `JoinForm` seeding precedence; the join e2e asserts a pre-filled field. `pnpm build`,
      lint, typecheck, and tests are green.
