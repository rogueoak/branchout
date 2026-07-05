# Spec roadmap

The ordered breakdown of Branch out into shippable specs. One spec is one independently
shippable feature and maps to one PR (see `docs/spectra/protocol.md`). Shared setup a group
needs lives in the first spec of that group; the rest reference it and stay small.

Written specs live beside this file as `NNNN-<slug>.md`. Items below without a number are
planned - they get a number and a full spec when their group comes up for build. Numbers are
assigned in build order, not written all at once, so the roadmap can shift as foundations land.

## Foundations

| Spec | Title | State |
|---|---|---|
| `0001` | Monorepo scaffold + local docker-compose (Postgres, Redis) | drafted |
| `0002` | Branch out Confetti theme on canopy (light + dark, AA) | drafted |
| `0003` | Brand assets - icon, favicon, wordmark lockup | drafted |

## Platform spine (control-plane)

- Accounts + anonymous play - account model, sign-up, anonymous sessions.
- Profiles - gamer tag, nickname, avatar picker, privacy, online + player status.
- Friends - search by tag, connect, invite.
- Stars - cross-game points and the profile badge.
- Subscriptions + credits - tiers, daily grant, credit ledger, affordability check.
- Purchases - subscribe, change tier, billing.

## Rooms and orchestration (control-plane)

- Room lifecycle - create/join/host, observers, presence.
- Modes and start rule - interactive vs remote, "at least one viewer".
- Game selection + start handoff to the engine; pause/restart/exit.
- Round reporting - engine results into billing and scoring.

## Game engine

- Engine skeleton - game registry, session state, device connect, streaming.
- Round protocol - engine <-> control-plane contract (lives in `packages/protocol`).
- First reference game - proves the full loop.

## Web

- Marketing site.
- Game client shell - lobby, interactive/remote layout, in-game.
- Profile pages + friend search/invite.

## Notes

- `0002` depends on canopy shipping its brandable theme API (a separate PR in rogueoak/canopy)
  and a `@rogueoak/roots` release that includes it.
- The engine <-> control-plane contract is shared TypeScript in `packages/protocol`; the spec
  that introduces it is the first of the game-engine group.
