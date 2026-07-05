# Features

What the product does for users, grouped by area. Each capability maps to one or more specs in
`docs/specs/README.md`. Checked = shipped; unchecked = planned.

## Foundations

- [x] Monorepo scaffold - pnpm + Turborepo workspace, shared config, CI, local docker-compose
      (Postgres + Redis) so the whole system runs with one command (spec `0001`).
- [ ] Branch out Confetti theme on canopy, light + dark, AA-verified (spec `0002`).
- [ ] Brand assets - icon, favicon, wordmark lockup (spec `0003`; assets already in `assets/`).

## Accounts and profiles

- [ ] Anonymous play and account sign-up; account required only to save progress or host.
- [ ] Public profile - gamer tag (always public), nickname (defaults to gamer tag), avatar from
      a set of cartoon characters, stars badge, recent-plays timeline.
- [ ] Privacy - profile public / friends-only / private (gamer tag and stars stay public).
- [ ] Presence - online status and player status (idle, or in a game and which one).
- [ ] Friends - search by gamer tag, connect, invite.

## Stars and monetization

- [ ] Stars - cross-game points (win 3, second 2, third 1; custom scoring allowed).
- [ ] Subscription tiers - Free / Gathering / Party, with daily credit grants.
- [ ] Credit ledger - balance, spend per round, block starting a game you cannot afford.
- [ ] Purchases - subscribe, change tier, manage billing.

## Rooms and orchestration

- [ ] Room lifecycle - create (for a game or empty), join by code, host, observers.
- [ ] Modes - interactive (viewer + remote) vs remote; the "at least one viewer" rule to start.
- [ ] Game selection and start handoff to the engine; pause, restart, exit.
- [ ] Round reporting - engine reports results; control-plane bills and scores.
- [ ] Rooms outlive a game - play another match or a different game from the same room.

## Game engine

- [x] Engine skeleton - modular game registry, Redis session state, device connect over
      WebSocket, pub/sub streaming, host controls (spec `0007`).
- [x] Round protocol - `packages/protocol` versioned envelopes for both channels (player <->
      engine WebSocket, engine <-> control-plane REST) plus idempotent round/complete reporting
      (spec `0007`).
- [ ] First reference game - proves the full loop end to end (Trivia, spec `0008`; a stub game
      drives the lifecycle in engine tests today).

## Web

- [ ] Marketing site - what Branch out is, tiers, sign-up.
- [ ] Game client shell - lobby, interactive/remote layout, in-game screens.
- [ ] Profile pages and friend search/invite.

## Future

- [ ] iOS and Android clients of the same services.
