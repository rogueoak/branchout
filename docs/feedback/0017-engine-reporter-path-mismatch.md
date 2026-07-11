# 0017 - Engine report intake path mismatch (reports 404'd in prod)

## Symptom

The engine -> control-plane report seam was mis-wired: the engine's `HttpControlPlaneReporter` POSTed
round and game-complete reports to `/rounds` and `/games/complete`, while the control-plane served the
intake at `/engine/rounds` and `/engine/games/complete`. The reporter's base URL is the control-plane
**origin** (`CONTROL_PLANE_URL`, e.g. `http://control-plane:4000`, no path), so every report went to
`http://control-plane:4000/rounds` -> **404**. Wherever `CONTROL_PLANE_URL` is set (it is in the prod
`.env.prod`), each finished round and each completed game failed to report: the per-round credit debit
and the game-complete stars award via this intake never landed. It was silent because the game itself
plays on without the report, and the local/e2e stacks left `CONTROL_PLANE_URL` unset (NoopReporter),
so the failure only manifested in the deployed environment.

## Root cause

Two ends of a server-to-server seam evolved independently with nothing pinning them together. The
reporter path literals (`/rounds`, `/games/complete`) and the route path literals (`/engine/rounds`,
`/engine/games/complete`) were written separately, and the only tests were at each end in isolation -
"the reporter POSTs to X" and "the intake serves Y" - neither asserting X == Y. The repo's own
learning ("Test the mapping at a seam, not just its two ends") had not been applied here.

## Fix

Discovered while versioning the APIs under `/v1` (spec `0033`): both ends now derive the intake paths
from **shared constants** in `@branchout/protocol` - `ENGINE_ROUNDS_SUBPATH` and
`ENGINE_COMPLETE_SUBPATH` - so the control-plane registers the routes at those subpaths (under its
`/v1` mount) and the reporter targets `V1_PREFIX + subpath`. The paths are now `/v1/engine/rounds` and
`/v1/engine/games/complete` on both sides, and they cannot drift apart because there is one literal.
The reporter's `baseUrl` is documented as the plain origin (no path suffix); the prod `.env.prod` and
the dev override already set it that way.

## Learning

When one value must equal another across a service boundary, make them **one value**, not two that a
test hopes are equal: share the path/key constant so the seam is correct by construction. A shared
constant beats a seam test here because it removes the failure mode instead of merely detecting it.
And treat "the two ends have tests" as a false comfort - a green suite that never asserts X == Y lets
a load-bearing equality be wrong (or reverted) undetected. This generalizes the existing seam learning
to *paths/keys*, not just ids. (Feeds `overview/learnings.md`.)
</content>
