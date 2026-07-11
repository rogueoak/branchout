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

## First vertical slice - landing page + Trivia end to end

The first proof that the whole platform works: a landing page that converts, and one game
(Trivia) played start to finish. Build order runs top to bottom; each is one PR.

| Spec | Title | State |
|---|---|---|
| `0004` | Accounts + anonymous play (control-plane) | drafted |
| `0005` | Landing page (web) | drafted |
| `0006` | Rooms, modes, orchestration + credit gating (control-plane) | drafted |
| `0007` | Game engine + round protocol (game-engine, `packages/protocol`) | drafted |
| `0008` | Trivia game logic (game-engine) | drafted |
| `0009` | Trivia question bank - 1600 questions (data) | drafted |
| `0010` | Web game client for Trivia (web) | drafted |

`0005` and `0009` can build early (they lean on the foundations, not the whole spine). `0008`
needs `0007` + `0009`; `0010` needs `0006` + `0007` + `0008`.

## Hosting

| Spec | Title | State |
|---|---|---|
| `0011` | Hosting + deploy - DigitalOcean droplet, Caddy TLS, private GHCR, GHA CD | drafted |

Builds on the scaffold's Dockerfiles + docker-compose (`0001`); deploys the app once the slice is
runnable. No droplet address or secret lives in the repo.

## Marketing surface, profiles, and room flow

A batch of player-facing features: profiles + avatars, a shared top nav, a guided room flow,
per-game feature pages for SEO, legal pages, and analytics. **Build `0033` (API versioning) first** -
it is foundational and moves every API under `/v1`, so the rest are built on the versioned base.
After that, build order is top to bottom; each is one PR. Dependencies noted below the table.

| Spec | Title | State |
|---|---|---|
| `0033` | **API versioning under `/v1`** (foundational - builds first) | drafted |
| `0027` | Player profiles + avatars (accounts, per-account stars/plays, profile + account pages) | drafted |
| `0028` | Top nav + account menu (shared chrome) | drafted |
| `0029` | Room flow - create -> pick a game -> invite; change game; icon+share invites | drafted |
| `0030` | Game feature pages + sitemap + home links | drafted |
| `0031` | Legal pages - privacy policy + terms of service | drafted |
| `0032` | PostHog product analytics (first-party) | drafted |
| `0034` | Zero-downtime deploys (docker-rollout, one service at a time) | drafted |

`0034` is independent infra (updates the spec `0011` pipeline) and can build in its own PR anytime;
sequence it **after `0033`** since both edit the Caddyfile. `0033` builds first (all `0027`-`0032` endpoints live under `/v1`). `0028` needs `0027`'s avatar,
account page, and `logout`. `0030`'s "Start a game" CTA uses the `?game=<slug>` deep link `0029`
defines, and reuses `0025`'s share cards. `0031` describes the analytics `0032` implements; both cite
the first-party posture. `0027`/`0030` extend the web game registry (`0023`).

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

- `0002` depends on canopy's brandable theme API (rogueoak/canopy PR #37 -
  `@rogueoak/roots/brand`) and a `@rogueoak/roots` release that includes it.
- The engine <-> control-plane contract is shared TypeScript in `packages/protocol`; the spec
  that introduces it is the first of the game-engine group.
