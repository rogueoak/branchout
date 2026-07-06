# Features

What the product does for users, grouped by area. Each capability maps to one or more specs in
`docs/specs/README.md`. Checked = shipped; unchecked = planned.

## Foundations

- [x] Monorepo scaffold - pnpm + Turborepo workspace, shared config, CI, local docker-compose
      (Postgres + Redis) so the whole system runs with one command (spec `0001`).
- [x] Branch out Confetti theme on canopy, light + dark, AA-verified (spec `0002`).
- [x] Brand assets - icon, favicon, wordmark lockup, OG image; `packages/brand` re-exports
      SVGs and generates rasters at build time (spec `0003`).

## Accounts and profiles

- [x] Anonymous play and account sign-up; account required only to save progress or host
      (spec `0004`). Email + password sign-up, log in / out, a `me` identity endpoint, editable
      nickname (defaults to the gamer tag), and a join-by-code path that mints an ephemeral
      anonymous session with no account row. Redis-backed sessions behind an httpOnly cookie;
      `/signup` and `/login` pages in `apps/web`.
- [ ] Public profile - gamer tag (always public), nickname (defaults to gamer tag), avatar from
      a set of cartoon characters, stars badge, recent-plays timeline.
- [ ] Privacy - profile public / friends-only / private (gamer tag and stars stay public).
- [ ] Presence - online status and player status (idle, or in a game and which one).
- [ ] Friends - search by gamer tag, connect, invite.

## Stars and monetization

- [x] Stars - cross-game points (win 3, second 2, third 1; ties share a rank). The control-plane
      converts the engine's final standings to stars on game complete (spec `0006`).
- [~] Subscription tiers - Free 10 / Gathering 50 / Party unlimited daily credit grants. The grant
      amounts and an injected tier provider ship in `0006`; real subscriptions (changing tier) are
      the Purchases spec, so every account is Free until then.
- [x] Credit ledger - an append-only Postgres ledger: idempotent daily grant by tier, one debit
      per round applied only by the round-report intake, a balance function, and an affordability
      check that refuses to start more rounds than the balance covers (Party unlimited) (spec
      `0006`).
- [ ] Purchases - subscribe, change tier, manage billing.

## Rooms and orchestration

- [x] Room lifecycle - a signed-in host creates a room with a 5-character join code (no ambiguous
      characters) and a `/join?code=ABC12` share link; players and observers join by code with a
      per-game nickname; the host can kick a member (blocked from rejoining on the same session,
      code still works for others). Live membership/presence in Redis, durable room + history in
      Postgres (spec `0006`).
- [x] Modes - each player picks interactive (viewer + remote) or remote; the "at least one viewer"
      rule (an observer or an interactive player) gates start (spec `0006`).
- [x] Game selection and start handoff - the host selects a game and an opaque config (passed
      through unchanged); start runs the affordability check then hands off to the engine via the
      protocol `StartHandoffRequest`; pause, restart, and exit proxy to the engine, and exit
      returns the room to the lobby (spec `0006`).
- [x] Round reporting - the engine's round-report intake debits one credit and records scoring;
      the game-complete intake converts standings to stars; both idempotent by report id, guarded
      by an internal token (spec `0006`).
- [x] Rooms outlive a game - the room returns to the lobby after a game so the host can play
      another match or a different game without recreating it (spec `0006`).

## Game engine

- [x] Engine skeleton - modular game registry, Redis session state, device connect over
      WebSocket, pub/sub streaming, host controls (spec `0007`).
- [x] Round protocol - `packages/protocol` versioned envelopes for both channels (player <->
      engine WebSocket, engine <-> control-plane REST) plus idempotent round/complete reporting
      (spec `0007`).
- [x] Trivia question bank - 1600 validated questions across 8 categories (Nature, Food, Animals,
      Science, People, Places, Things, History), 200 per category, with loader and validator module
      enforcing schema, difficulty-tier balance, and uniqueness constraints (spec `0009`).
- [x] First reference game - Trivia: host-configured category (8 + Random), rounds (1-100,
      default 10) and difficulty (1-10, default 5) driving a blended easy/medium/hard question
      draw; free-text answer matching (normalized exact plus Levenshtein-1 for 5+ char answers);
      100 points for a correct answer; a 10s dispute window with a majority vote of the other
      players awarding 50; between-round leaderboard, host-advance, and final standings for stars
      (spec `0008`). Registered in the engine registry alongside the lifecycle stub.

## Web

- [ ] Marketing site - what Branch out is, tiers, sign-up.
- [ ] Game client shell - lobby, interactive/remote layout, in-game screens.
- [ ] Profile pages and friend search/invite.

## Future

- [ ] iOS and Android clients of the same services.
