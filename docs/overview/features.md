# Features

What the product does for users, grouped by area. Each capability maps to one or more specs in
`docs/specs/README.md`. Checked = shipped; unchecked = planned.

## Foundations

- [x] Monorepo scaffold - pnpm + Turborepo workspace, shared config, CI, local docker-compose
      (Postgres + Redis) so the whole system runs with one command (spec `0001`).
- [x] End-to-end tests - a Playwright harness (`e2e/`) drives a real browser against the full
      docker-compose stack (web + control-plane + game-engine + Postgres + Redis): the Open Graph
      share unfurls, a full two-player Trivia round, and a mobile-first render guard at a phone
      viewport. Its own CI job (`pnpm e2e`); the fast unit run stays Docker-free (spec `0021`).
- [x] Branch out Confetti theme on canopy, light + dark, AA-verified (spec `0002`).
- [x] Brand assets - icon, favicon, wordmark lockup, OG image; `packages/brand` re-exports
      SVGs and generates rasters at build time (spec `0003`).
- [x] Per-game marks and social share cards - on-theme game logos (`Trivia` = a branch-graph
      question mark, `Liar Liar` = a masquerade mask on a stick, both keeping the gold-root rule),
      a home Open Graph card built around the wordmark + tagline, and per-game "Join my game" share
      cards (game art + the mark, generic fallback) unfurled by share links (spec `0020`).
- [~] Hosting and deploy - `branchout.games` on a DigitalOcean droplet behind a Caddy edge proxy
      (auto-TLS, HSTS, same-origin `/api` + `/ws` routing), the three apps as private GHCR images
      plus Postgres + Redis, rolled forward hands-off by `release.yml` on every push to `main`
      (health-gated `up -d --wait`, `sha-<commit>` pins, rollback by redeploy). Pipeline built in
      spec `0011`; first cutover (one-time coming-soon decommission + secrets) is operator-run.

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
      rule (an observer or an interactive player) gates start (spec `0006`). The picker defaults from
      the device (mobile -> remote, TV -> interactive, else interactive) and is always overridable
      (spec `0013`).
- [x] Host is a player - the host is a full player (`role: 'player'` with an `isHost` flag), not a
      separate role: it appears in the engine roster, answers, disputes, and lands in the final
      standings earning stars like anyone. `isHost` carries only the admin powers (controls, kick,
      seeing others' `sessionId`); the host is never kickable and cannot opt out of playing. An
      interactive host is a viewer, so a solo host satisfies the start gate (spec `0013`).
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
      Science, People, Places, Things, History), 200 per category, each rated 1-10 for difficulty
      (spec `0016`), with loader and validator enforcing schema, difficulty range + spread, and
      uniqueness constraints (specs `0009`, `0016`).
- [x] First reference game - Trivia: host-configured category (8 + Random), rounds (1-100,
      default 10) and a difficulty min-max range (1-10, default 4-6, spec `0016`) that draws only
      questions rated in the range (widening to the nearest rating when exhausted); free-text answer
      matching (normalized exact plus Levenshtein-1 for 5+ char answers);
      100 points for a correct answer; a 10s dispute window with a majority vote of the other
      players awarding 50; between-round leaderboard, host-advance, and final standings for stars
      (spec `0008`). Registered in the engine registry alongside the lifecycle stub.
- [~] Second game - Liar Liar: a Fibbage-style bluffing game on the generic guess/decision lifecycle
      (spec `0020`). The viewer shows an improbable-but-true clue; players invent a fake within 90s
      (a duplicate or the real answer is rejected privately), the reveal lists every fake plus the
      truth, players guess within 30s, and scoring awards 100 for the truth and 50 per player a fake
      fools. Engine-side game logic ships as `@branchout/game-liar-liar` (spec `0021`); the web client
      is spec `0023`.
- [x] Liar Liar clue bank - a research-sourced seed of ~119 absurd-but-true clues across the eight
      categories (people, places, events, sports, food, nature, animals, things), each carrying a
      `source` URL, gated by `validateSeedBank` (coverage, id convention, prompt uniqueness). Liar Liar
      is now registered in the engine boot alongside Trivia, so a host can start and play it (spec
      `0022`).

## Web

- [x] Marketing landing page - hero (tagline, CTA), "how it works" three steps, Trivia games
      teaser (the whole card is a link into the play path - signup when anonymous, rooms when
      signed in), footer. Dark theme by default; pricing/tier content is dropped for now.
      Signed-in visitors see "Play now" instead of "Sign up free" via a server-side session
      check; graceful fallback to anonymous view if the control plane is unreachable (spec `0005`).
- [x] Game client shell - the browser client for Trivia (spec `0010`). A rooms home to create a
      room (host) or join by code, and the `/join?code=ABC12` share-link route where a player picks
      a nickname, player/observer, and interactive/remote (minting an anonymous session if needed).
      A host config panel (category incl. Random, rounds 1-100, difficulty 1-10) with a Start button
      gated on a viewer being present, valid settings, and the server's affordability check. The
      in-game stage renders by mode and role from one layout (viewer left, remote right, stacked on
      small screens; observer/host see the viewer, remote players the controller): prompt, free-text
      answer, reveal + scoring, a dispute button in the 10s window, a vote UI, a between-round
      leaderboard, host controls (advance/pause/restart/exit), and a final results screen with
      stars. A protocol-typed WebSocket client (`lib/game-client.ts`) folds prompt/reveal/
      leaderboard/state into a pure state machine and reconnects. Built on canopy + the Confetti
      theme, light/dark, responsive, a11y (spec `0010`).
- [x] Link unfurls (Open Graph) - the home page unfurls with the wordmark + tagline card, and a
      `/join?code=ABC12` share link unfurls as "Join my game" over the room's game art with the
      Branch out mark in the corner. The join page's `generateMetadata` resolves the room's game
      server-side via a public `GET /rooms/:code/preview` (a crawler is not a member, so `getRoom`
      cannot serve it); any failure falls back to a generic invite card so every link unfurls.
      `twitter:card` is `summary_large_image` for large cards on X/iMessage (spec `0020`).
- [x] Trivia end-to-end integration - closes the three integration gaps from `0010` so a full
      game is playable by the host and non-host players (spec `0012`). Each room member gets a
      public `playerId` (minted on create/join, stored beside the private `sessionId` in Redis)
      that keys the engine start-handoff roster and the engine `join`; `POST /rooms/:code/join`
      returns it and `/members` carries it on every row, while `sessionId` stays host-only.
      `advance` is on the `/rooms/:code/control` allow-list, and the protocol `state` frame now
      carries `disputes` (the round's disputers) so the vote UI targets exactly them. The Trivia
      affordability pre-gate still relies on the server's `insufficient_credits` refusal (gap 4,
      accepted as-is).
- [x] Trivia is playable end to end (feedback `0014`) - the fixes that turned a broken flow into a
      real round: the control-plane reaches the engine over `ENGINE_URL` (a network failure is a
      logged 502, not a silent 500); the engine persists the round's prompt/reveal/standings and
      replays them as catch-up on `join`, so a late joiner or reconnecting device sees the current
      question; a `GET /rooms/:code` room-view endpoint, polled in the lobby, lets a non-host device
      detect `running` and enter the game; the web prompt decoder accepts the question's tier-string
      difficulty; and the controller shows the question to a remote-only player.
- [x] Host-disconnect pause (spec `0014`) - the game auto-pauses when the host's device drops
      mid-game and resumes when it reconnects, so a stranded round waits for the host rather than
      hanging. The engine carries `isHost` on its roster (from the handoff) to know whom to watch;
      a deliberate host pause is tracked separately so an unrelated reconnect never un-pauses it.
- [x] Trivia play polish (feedback `0015`) - the answer round auto-closes 2s after every connected
      player has submitted (the host can still advance sooner); revealed answers are title-cased for
      display while storage and matching stay lowercase; and the Dispute button is hidden in a solo
      game, where no other player exists to vote.
- [x] Answer round: 60s timer + reveal every answer (spec `0017`) - each question shows a 60-second
      countdown (engine-driven deadline, sent as skew-proof remaining ms on the `state` frame); at
      zero the player's typed answer auto-submits and the engine force-closes the round (the 2s
      all-answered early close still applies, so 60s is the ceiling). Pausing freezes the clock and
      resuming continues from the time left. At reveal, the viewer shows every player's submitted
      answer with a correct/wrong marker.
- [ ] Profile pages and friend search/invite.

## Future

- [ ] iOS and Android clients of the same services.
