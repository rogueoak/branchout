# 0024 - Teeter Tower known issues (deferred from the round-2 review)

Two pre-existing issues surfaced during the feedback `0023` (round-2) review. Both are out of scope
for that PR (they predate it and are not caused by it), but they are real and worth a follow-up. Filed
here so they are tracked, not lost.

## 1. A free-tier insider cannot afford to start Teeter Tower

**Symptom.** A brand-new insider account cannot start Teeter. The start silently no-ops (the board never
appears) because the account cannot afford it.

**Cause.** Starting a game checks affordability for the requested round count. Teeter's round count is its
summed piece budget (`TOTAL_ROUNDS = 11 + 20 + 22 = 53`), so a start reserves ~53 credits. A `free`-tier
account gets only the daily grant (`DAILY_GRANT.free = 10`). 53 > 10, so `canAfford` fails and
`RoomService.start` throws `insufficient_credits`. Insider status does not change the tier/grant.

**Impact.** Any new insider on the free tier is blocked from the game until they somehow acquire ~53
credits - there is no in-product path for that today. The e2e works around it with a test-only
`grantCredits` top-up (see `e2e/lib/stack.ts`), which is scaffolding, not a fix.

**Options (a product decision, not an engine one).**
- Price live games per-game (a flat cost) rather than per-nominal-round - Teeter is not really 53 turns.
- Give the game a shorter free-playable variant, or a higher/one-off insider grant.
- At minimum, a clear pre-start "you need N credits" message so the start does not silently no-op.

## 2. Airborne-peak scoring can clear a level before the tower settles

**RESOLVED in feedback `0025` (round 3):** `worldHeight` now counts only settled (at-rest) bodies, so a
piece still falling no longer contributes its airborne peak. See `0025` #1.

**Symptom.** A piece dropped high can score a height band - and even clear a level - that the resting
tower never actually reaches. To a player this reads as luck or the game cheating.

**Cause.** The live tick banks `world.bestHeight = max(bestHeight, worldHeight(world))` every step, and
`worldHeight` reads the instantaneous topmost `bounds.min.y` of placed bodies (`physics.ts`), then the
level clears on `height >= level.target` (`teeter-tower.ts`). There is no at-rest/settle gate, so a body
still falling (or swaying) contributes its airborne peak. The min-drop line only enforces a floor (each
drop must clear the next 25% line), not a ceiling, so a piece can legally be released high.

**Impact.** Normal play (dropping just above the current tower) builds upward as intended, so this is a
"you can cheese it if you try," not "every drop clears." It was masked further by the desktop hover
re-aim bug fixed in `0023` (which forced every drop high); with that fixed, normal play is fine, but the
underlying peak-counts-airborne behavior remains.

**Fix direction.** Gate scoring/level-clear on a settled tower: only bank `bestHeight` for bodies at rest
(velocity below a threshold), or ignore height contributed by bodies still in free-fall. Add an engine
test that drops a piece momentarily above target that settles below, and asserts the level does NOT
advance on the peak tick. This is an engine-scoring change with its own test surface, so it is deferred
to its own pass rather than folded into a UX-fix PR.

## Learning

A per-round credit reservation silently blocks a game whose nominal round count dwarfs the free grant -
"rounds" is the wrong cost unit for a live game that ends on a physics condition, not on turns. And a
continuously-stepped physics world must decide *when* a height counts: sampling the instantaneous peak
every tick rewards the drop height, not the built height. Both are "the number is measured at the wrong
moment/unit" bugs - cheap to state, easy to miss until someone plays the edge.
