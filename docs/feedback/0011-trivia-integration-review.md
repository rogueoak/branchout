# 0011 - Persona review of the Trivia integration (spec 0012)

## Symptom

Two majors surfaced in persona review of PR #15 (spec `0012`), both passing the green build/test
gate before review:

1. **Architect (major).** `disputes` was added as a *required* field on the versioned `state`
   frame without bumping `PROTOCOL_VERSION` and without the reader tolerating its absence. `state`
   is the on-join recovery frame, so a peer predating the field (e.g. an engine mid rolling-restart)
   still passes the `v === 1` gate yet omits `disputes`; the web reducer stored `frame.disputes`
   and `RemotePane` called `disputes.filter(...)`, so `undefined.filter` would crash the client.
   This directly contradicted the invariant the same PR wrote into `architecture.md`: "a shape can
   change without breaking older peers."
2. **Tester (major).** The linchpin of the whole non-host flow - that the engine handoff roster is
   keyed by the public `playerId` and not the httpOnly `sessionId` - was not pinned by any test.
   The engine test proved the engine *accepts* a roster playerId and the service test proved `join`
   *echoes* one, but nothing asserted `engine.starts[0].players`. Reverting the one line
   (`member.playerId` -> `member.sessionId`) kept every test green while making it impossible for a
   non-host to `join` the engine.

## Root cause

1. Treating an additive wire field as required. An envelope carries a version *precisely* so a
   field can be added under the same version and read defensively; making the new field required
   turns an additive change into a breaking one and voids the version's promise.
2. Coverage tested each half of a seam (identity minted/echoed; engine accepts a roster id) but not
   the mapping that joins them (roster keyed by the public id). A behavior no single test exercises
   can be silently reverted with the suite still green.

## Fix

1. Made `disputes` optional on `StateMessage` (`disputes?: string[]`) and defaulted it at the read
   boundary (`frame.disputes ?? []` in the web reducer); kept `PROTOCOL_VERSION` at 1. Added a
   reducer test that a `state` frame lacking the field yields `[]`.
2. Added a service test asserting `engine.starts[0].players` maps the member's public `playerId`
   (exactly what `join` returned) and is NOT the session id.

## Learning

Two rules, both general past this change - see `overview/learnings.md`:

- **A new field on a versioned envelope is optional-and-defaulted unless you bump the version.**
  The version stamp exists so shapes grow without breaking older peers; a *required* addition under
  the same version breaks the one guarantee versioning buys. Add it optional, default its absence at
  the boundary, and reserve a version bump for a genuinely breaking change.
- **Test the mapping at a seam, not just its two ends.** When one value has to equal another across
  a boundary (the handoff roster key must be the id `join` returned, not a different id on the same
  object), assert that equality directly. Testing "an id is minted" and "the engine accepts an id"
  leaves the load-bearing "it is the *right* id" line free to be reverted with the suite green.

## Also noted (not fixed)

- **Architect (minor).** `join` returns `{ room, playerId }` but `create` mints a `playerId` and
  returns only the room, so the host learns its own identity via a `/members` round-trip (the
  dual-path `me` in `RoomClient`). Left as-is: the host only needs `me` once the game is running, by
  which point the roster poll has resolved, so the window is harmless; changing `create`'s return
  type ripples across many call sites for no functional gain. The `/members` self-row read is an
  established pattern (it was how the host read its identity before this spec too).
</content>
