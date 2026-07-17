# Features

What the product does for users, grouped by area. Each capability maps to one or more specs in
`docs/specs/README.md`. Checked = shipped; unchecked = planned.

## Foundations

- [x] Monorepo scaffold - pnpm + Turborepo workspace, shared config, CI, local docker-compose
      (Postgres + Redis) so the whole system runs with one command (spec `0001`).
- [x] End-to-end tests - a Playwright harness (`e2e/`) drives a real browser against the full
      docker-compose stack (web + control-plane + game-engine + Postgres + Redis): the Open Graph
      share unfurls, a full two-player Trivia round, and a mobile-first render guard at a phone
      viewport. Its own CI job (`pnpm e2e`); the fast unit run stays Docker-free (spec `0026`).
- [x] Branch out Confetti theme on canopy, light + dark, AA-verified (spec `0002`).
- [x] Brand assets - icon, favicon, wordmark lockup, OG image; `packages/brand` re-exports
      SVGs and generates rasters at build time (spec `0003`).
- [x] Per-game marks and social share cards - on-theme game logos (`Trivia` = a branch-graph
      question mark, `Liar Liar` = a masquerade mask on a stick, both keeping the gold-root rule),
      a home Open Graph card built around the wordmark + tagline, and per-game "Join my game" share
      cards (game art + the mark, generic fallback) unfurled by share links (spec `0025`).
- [~] Hosting and deploy - `branchout.games` on a DigitalOcean droplet behind a Caddy edge proxy
      (auto-TLS, HSTS, same-origin `/api` + `/ws` routing), the three apps as private GHCR images
      plus Postgres + Redis, rolled forward hands-off by `release.yml` on every push to `main`
      (health-gated `up -d --wait`, `sha-<commit>` pins, rollback by redeploy). Pipeline built in
      spec `0011`; first cutover (one-time coming-soon decommission + secrets) is operator-run.
- [x] External game data - the real game banks live in a separate **private** repo, not the public
      one. The public repo ships only a tiny valid sample; production reads the full bank from the
      private repo, pinned to the tag in `deploy/data.version`, pulled on the deploy box via a
      read-only deploy key, then bind-mounted read-only into `game-engine`/`admin` (the engine loader
      reads it via `GAME_DATA_DIR`) (spec `0041`).

## Accounts and profiles

- [x] Anonymous play and account sign-up; account required only to save progress or host
      (spec `0004`). Email + password sign-up, log in / out, a `me` identity endpoint, editable
      nickname (defaults to the gamer tag), and a join-by-code path that mints an ephemeral
      anonymous session with no account row. Redis-backed sessions behind an httpOnly cookie;
      `/signup` and `/login` pages in `apps/web`.
- [x] Public profile - gamer tag (always public), nickname, an avatar chosen from a fixed set of
      12 on-theme cartoon characters (bundled brand SVGs, deterministic default seeded from the tag),
      a total-stars badge, and a recent-plays timeline, at `/u/[gamerTag]`; a signed-in player
      manages nickname/avatar/visibility and logs out at `/account`. Per-account game history is
      recorded at the game-complete intake (mapping each standing's `playerId` -> the room member's
      `accountId`, idempotent), since `room_games.stars` is keyed by the ephemeral player id (spec
      `0027`).
- [x] Privacy - profile public / friends-only / private, applied as a server-side projection on the
      public read (gamer tag and total stars always public; the rest gated). `friends-only` resolves
      to private-to-non-owners until the friend graph ships (spec `0027`).
- [x] Account deletion - a "Danger zone" on `/account` lets a player soft-delete their own account
      behind a two-step confirm: the row is kept (flagged `deleted_at`, still visible to admins) but
      the email + gamer tag are freed for reuse, and the player is logged out and cannot sign back
      in. An admin can hard-delete any player from the console (purges the row + game history, keeps
      the credit ledger for audit; hosted rooms are left intact since their history is shared). The
      admin list/detail flag a soft-deleted account as "Deleted" (spec `0040`).
- [ ] Presence - online status and player status (idle, or in a game and which one).
- [ ] Friends - search by gamer tag, connect, invite (then `friends-only` gains real gating).

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
- [x] Modes and viewers - every member has one mode: `viewer` (watch only, a shared screen),
      `interactive` (play + show the game on this screen), or `remote` (controller only). `viewer`
      replaces the old observer role; playing = interactive|remote (fills the roster, counts toward
      limits); display = viewer|interactive (a screen). Start needs a display and at least the game's
      minimum players. The picker lives in the lobby ("Your mode") with per-option descriptions and
      defaults in priority order: remembered device mode -> no interactive member yet -> second join
      -> mobile -> interactive (specs `0006`, `0013`, `0050`).
- [x] Per-game player limits - Trivia 1-8, Liar Liar 2-8, Teeter 1-4, Lone Leaf 3-7, shared via `@branchout/protocol`
      so the lobby and the control-plane agree. At the max a playing joiner is clamped to `viewer`;
      below the min Start is blocked. Viewers never count toward the total or paid rounds (spec `0050`).
- [x] Host - the host has a mode like anyone (defaults to interactive) plus an `isHost` flag: it
      appears in the engine roster, answers, disputes, and lands in the final standings earning stars.
      `isHost` carries only the admin powers (controls, kick, seeing others' `sessionId`); the host is
      never kickable. An interactive host is a display, so a solo host satisfies the screen gate
      (specs `0013`, `0050`).
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
- [x] Trivia question bank - questions across 8 categories (Nature, Food, Animals, Science, People,
      Places, Things, History), each rated 1-10 for difficulty (spec `0008`), with a loader and a
      structural validator (schema, id format + uniqueness, bounded difficulty, no duplicate prompt
      in a category - no total/per-category count or spread gate, spec `0041`). The public repo ships
      a small sample; the full bank is served from a private data repo mounted at deploy time (specs
      `0009`, `0041`).
- [x] First reference game - Trivia: host-configured category (8 + Random), rounds (1-100,
      default 10) and a difficulty min-max range (1-10, default 4-6, spec `0008`) that draws only
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
- [x] Liar Liar clue bank - research-sourced absurd-but-true clues across the eight categories
      (people, places, events, sports, food, nature, animals, things), each carrying a `source` URL,
      gated by `validateClueBank` (schema, `<category>-NNN` id convention + uniqueness, prompt
      uniqueness in a category - structural only, no coverage gate, spec `0041`). The public repo
      ships a small sample; the full bank is served from the private data repo mounted at deploy time.
      Liar Liar is registered in the engine boot alongside Trivia, so a host can start and play it
      (specs `0022`, `0041`).
- [~] Third game (insider-only) - Teeter Tower: a physics stacking game where a turn is
      `{ angle, dropX, dropY }` on the generic `move` channel (spec `0042`). Unlike the quiz games the
      physics is **server-authoritative AND continuous** - Matter.js runs headless in the engine as a
      per-session live world stepped on a ~25 fps tick loop and streamed live via a `sim` frame, so
      the tower keeps swaying and can topple on its own and every client sees the identical live tower;
      the browser is a pure renderer on a single interactive canvas (no slider, no re-aim). The drop
      must clear the 25%-from-top line and level 1's target is 600 (`@branchout/game-teeter-tower`,
      spec `0043`). Gated by SURFACE, not entitlement (feedback `0029`): a game `visibility: 'insider'`
      flag hides it from the public picker/pages/sitemap, and the room picker offers it only on the
      insider surface (`getSurface()` reads the request host), so it never shows on the apex even to
      an insider. The insider home card deep-links into a room RELATIVELY, and the room/join flow is
      mirrored under the gated `/insider` tree, so play stays on the insider host end to end.
      Playable solo now; the turn abstraction (active player = `round % players`) is built for
      multiplayer later. Playtest tuning (feedback `0032`): floor-only static grip pins the base row
      without stiffening piece-on-piece; the piece bag adds two concave "notch" pieces and makes the
      hard shapes (L/octagon/triangle) rare; the spinning piece follows the cursor vertically; a
      below-the-line drop is clamped to the line, not blocked; and clearing a round plays a
      server-authoritative "Complete!" -> "Round X" beat (a `phase` on the streamed sim).
- [~] Board games (insider-only), first entry Reversi - the classic 8x8 two-player disc-flip game,
      and the reusable **board harness** Checkers and Chess follow (spec `0054`). Reversi uses the LIVE
      model (like Teeter) but its state is fully serializable, so the whole game - board, turn, and
      pass-state - lives in **scratch** with **no in-process world** (no Matter.js, no `disposeLive`).
      A turn is `{ row, col }` on the generic `move` channel; the engine validates turn + legality and
      applies the flip (rejecting an illegal/out-of-turn move to that device only), streams the whole
      board on the `sim` frame, and ends the game when neither side can move (custom 2-player standings
      by final disc count). It is PERFECT information, so it does NOT use the per-player private
      channel (spec `0052`). The board machinery is factored for reuse: a serializable `Grid`,
      eight-direction ray helpers, two-seat turn management (`packages/games/reversi/src/board.ts`), and
      a single-surface board renderer with the layout + tap hit-test in a game-agnostic `board-render.ts`.
      Themed Violet vs Amber discs (canopy grape/sunbeam tokens, no hardcoded hex) on a wood-grain
      board (`@branchout/game-reversi`). Insider-gated by SURFACE like Teeter (feedback `0029`).
- [~] Checkers (insider-only) - classic English draughts, the SECOND board game and the first to reuse
      the shared board harness Reversi factored out (spec `0055`). It reuses the `@branchout/game-board`
      package (`Grid`, the `DIAGONAL` rays, `Turns`/`assignSeats`) and the shared web `../board/geometry`
      wholesale - only the rules and the piece chrome (Violet vs Amber acorn men, a gold-root crown ring
      on a King) are Checkers-specific. Like Reversi it is LIVE + fully serializable (board in scratch,
      no in-process world, no `disposeLive`) and PERFECT information (no spec `0052`). The rules ship
      **standard English draughts**: men move/capture diagonally forward, jumps chain (multi-jump forced
      to completion), MANDATORY CAPTURE is on (any available jump is legal - not the "longest jump"
      variant), a man that stops on the far row is crowned a King (crowning mid-chain ends the turn), and
      the side to move with no legal move loses (no draw). A move is `{ from, path }` on the generic
      `move` channel; the engine validates turn + full legality (incl. mandatory capture and the whole
      multi-jump path, rejecting to that device only) and streams the whole board on `sim`. The web
      Viewer is a select-then-move two-tap surface (tap a piece, then a highlighted destination; a
      multi-jump submits whole). Standings rank the winner first even when the loser has more pieces
      (`@branchout/game-checkers`). Insider-gated by SURFACE like Teeter (feedback `0029`).
- [x] Per-player private payloads - the hidden-information seam the next wave of games (spymaster
      key, hidden role, private hand) build on (spec `0052`). A lifecycle result may carry an optional
      `private` map (playerId -> opaque secret); the engine delivers each entry ONLY to that player's
      device(s) over a per-player private channel - never the broadcast channel, so no other player
      receives it even off the wire. It is a new server-only `private` frame (targeted like
      `move_rejected`, additive under the same `PROTOCOL_VERSION`), persisted per round for join
      catch-up (a reconnect recovers its own secret) and cleared when the next round starts. The web
      client exposes the local player's secret as `state.private` for a game's UI module.
- [~] Fourth game (insider-only) - Lone Leaf: a COOPERATIVE single-clue word game for 3-7 players and
      the first game built on the per-player private channel (spec `0057`). Each round one player is the
      Seeker (the role rotates by seat) and must guess a hidden mystery word - the seed - that they
      alone cannot see; every other player secretly writes ONE one-word clue (a leaf). Before the Seeker
      looks, matching or invalid leaves wilt (are cleared, both of a duplicate pair, folding case and a
      light stem), so only the unique leaves survive. The Seeker sees the survivors and takes one guess;
      scoring is cooperative - a correct guess banks a point for everyone and all players share the
      standing. The seed rides the spec `0052` private channel to the non-Seekers ONLY and never the
      broadcast prompt/viewer/reveal, so the Seeker's device never receives it (a unit test proves the
      Seeker is absent from the private map, and the e2e proves the seed shows on a non-Seeker's device
      but nowhere on the Seeker's). Insider-only by surface (feedback `0029`), with a bundled ~60-word
      sample seed bank (`@branchout/game-lone-leaf`).
- [~] Fifth game (insider-only) - Same Branch: a spectrum-guessing party game (2-8 players) on the
      round-based lifecycle (`@branchout/game-same-branch`, spec `0058`). Each round shows a branch
      running between two opposites (the **branch**); a hidden target (the **bud**) sits on it. One
      player - the **Reader**, rotating by seat each round - alone sees the bud and reads a one-line
      **hunch**; everyone else drags the **sap line** (a 0-100 dial) to guess where the bud is, and the
      reveal scores each guess by closeness (bullseye 4 / close 3 / near 2 / miss 0). Two modes: free-
      for-all (per-player scores) and co-op (one pooled grove score). **The bud is a real secret**: it
      is delivered ONLY to the Reader's device via the per-player private channel (spec `0052`) and is
      never in the broadcast prompt or any pre-reveal payload, so no other device ever receives it. A
      sample spectrum bank (~120 opposite pairs across six categories) ships bundled with a structural
      validator; the full bank later lives in the private data repo (spec `0041`). Same insider
      surface gating as Teeter (visibility `insider`, hidden from the public picker/pages/sitemap). The
      web remote's branch dial is a touch-first, keyboard-operable ARIA slider that works at 360px.

## Web

- [x] Marketing landing page - hero (tagline, CTA), "how it works" three steps, games teaser, footer.
      Dark theme by default; pricing/tier content is dropped for now. Each teaser card carries a wide
      on-brand hero illustration (per-game 800x450 scene from `@branchout/brand`, gold-root rule kept)
      above the title and is a link into the feature page; a signed-in player also gets a per-card
      "Play <game> now" deep link into the room flow. Signed-in visitors see "Play now" (pointing at
      `/games` so they pick a game before hosting) instead of "Sign up free" via a server-side session
      check; graceful fallback to anonymous view if the control plane is unreachable (specs `0005`,
      `0046`).
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
      `twitter:card` is `summary_large_image` for large cards on X/iMessage (spec `0025`).
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
- [x] Room create flow and richer invites (spec `0029`) - hosting is a stepped, phone-first flow:
      create a room -> pick a game (shown as a detail card: mark, name, tagline, summary - not a bare
      title) -> invite friends. A `?game=<slug>` deep link (the "Start a game" CTA a feature page
      will use, spec `0030`) pre-selects the game and skips the pick step, landing on invite. The
      invite affordance is the room code as a link into the join URL, a copy-icon button (not the
      word "Copy"), and a share button that opens the native share sheet where supported (falling
      back to copy on desktop) - reused in the invite step and the lobby. In the room, a "Change
      game" button reopens the card picker; the lobby shows the selected game's detail card and its
      config panel. The per-game summary lives on the web game registry so the picker and a later
      feature page share one source.
- [x] Top nav and account menu - a shared `TopNav` (wordmark + Games link on the left; Sign up (the
      one primary) + Log in on the right when signed out; the player's avatar with an accessible
      dropdown to Manage account / Log out when signed in). Auth state is read server-side
      (`getViewer`) and injected so the correct nav renders on the first byte (no flash). Present on
      the marketing and rooms/join surfaces, omitted inside a running game (spec `0028`).
- [x] Legal pages - a plain-language `/privacy` (first-party analytics, what accounts store,
      anonymous play, IP/logs, processors, children, rights) and `/terms` (acceptance, acceptable
      use, an "as is" no-warranty disclaimer, a liability limit, and a terms-can-change-any-time
      clause). A shared `Footer` links to both from the marketing and rooms/join surfaces; the
      contact email and last-updated date come from one constant each (spec `0031`).
- [x] Product analytics - first-party PostHog (spec `0032`). PostHog JS talks to a same-origin
      `/ingest` path (Next rewrites -> PostHog US), so every request is to our own domain; it runs in
      production only (a no-op in dev/test/CI and when the key is unset). One `lib/analytics.ts` owns
      the event names and fires the funnel (room created, game picked, invite copied/shared, join,
      game started, game completed) plus manual pageviews; a signed-in player is identified by their
      public gamer tag, reset on logout. Session replay and autocapture are off, so no gameplay
      content or PII is captured. The key is baked into the web image at build time.
- [x] Insider surface - a beta-tester surface at `insider.branchout.games`, served by the same
      `web` process via host-aware middleware (no extra container). Gated by an account-level
      `insider` role (surfaced through `/auth/me`): the tree's layout sends a signed-out visitor to
      the apex login and returns a real 403 for a signed-in non-insider; the apex cannot reach the
      tree by path. One login spans the apex and the subdomain (session cookie scoped to
      `.branchout.games`). It reuses the main look and feel with an "Insider" nav label and an
      empty-state index of test games (games added later). The role is granted out-of-band (a DB
      update) until the admin console (spec `0037`) ships a toggle (spec `0035`). The account page
      shows an "Insider game previews" button that links to the surface, rendered only for insider
      accounts (spec `0039`). The nav's Games link and the wordmark/home are **surface-owned**: on
      the insider host they stay relative (Games reaches the insider games on the landing, the
      wordmark returns to the insider landing), and only the genuinely apex-only chrome (Log in /
      Sign up / Manage account, footer legal) crosses to the apex; the landing leads with one
      centered welcome and each test-game card carries a "Play now" CTA (feedback `0030`).
- [x] Host in-game feedback - a "Feedback" button, right-aligned in the host-controls row, opens a
      ResponsiveDialog (a modal on desktop, a bottom sheet on a phone) where the host types a note at
      any point during a game. Submitting emails it to feedback@rogueoak.com (from
      branchout@rogueoak.com) via Resend, with auto-captured context attached (room code, game id,
      current phase, that the sender is the host, a timestamp) so the note is actionable without a
      back-and-forth. The control-plane endpoint (POST /v1/feedback) is cookie-authenticated and
      host-verified, validates the message, caps submissions per IP, and - until an operator provisions
      RESEND_API_KEY - returns a clear "not configured" response rather than crashing (spec 0048).
- [x] Newsletter subscribe - a "More games coming soon" banner on `/games` with a "Subscribe for
      updates" button that reveals an on-theme, mobile-first subscribe form. Submitting posts the email
      to the control-plane's `POST /v1/subscribe`, which adds the visitor to the Constant Contact
      "Branch Out" list (OAuth refresh-token -> access-token exchange with an in-memory cache + 60s skew
      + single-retry self-heal on a stale-token 401; `sign_up_form` opt-in). A hidden honeypot
      (`company`) drops naive bots and the endpoint is rate-limited per IP; failures return generic
      messages and never echo a subscriber's email. The endpoint ships INERT - a clear "Subscribe is not
      configured yet." 503 until an operator provisions `CTCT_CLIENT_ID`/`CTCT_REFRESH_TOKEN`/
      `CTCT_LIST_ID` (spec `0047`). A daily host cron (`deploy/ctct-refresh/ctct-keepalive.sh`) exercises
      the refresh token out-of-band so it never expires from disuse, persists a rotated token atomically,
      and emails a Resend alert on failure; the deploy preserves the box's (rotated) token across runs
      (spec `0049`).
- [x] Game library, rules overview, and in-game help sheet (spec `0051`) - one taxonomy + rules layer
      over the registry. `lib/games/library.ts` holds a controlled category + tag vocabulary, a
      structured `GameRules` shape (an objective plus headed sections), a per-game `GAME_LIBRARY`
      entry, and search/lookup helpers, with a fail-loud completeness check (every registered game
      needs an entry; every declared category/tag must be in the vocabulary). The `/games` index gains
      a client search box + native category filter and category/tag chips per card (a no-match state
      reads as intentional); the `/games/[slug]` feature page adds a full Rules section and the chips.
      A shared, presentational `RulesContent` renders the same rules in three homes. A responsive
      `Sheet` (Radix Dialog: bottom on mobile, right on desktop, backdrop/close/Escape dismiss) hosts a
      `HelpSheet` behind an always-present "?" help control in `GameStage` - reachable for every mode
      and phase, opening the rules over the live game without pausing or ending it. The insider index
      exposes each game's rules via a separate "How to play" trigger, since insider games have no
      public feature page. Backfilled for Trivia, Liar Liar, and Teeter Tower.
- [ ] Profile pages and friend search/invite.

## Future

- [ ] iOS and Android clients of the same services.

## Admin console (spec 0037)

An operator console at `admin.branchout.games` (a separate Next.js app with a separate admin identity):
sign in as an admin, create more admins, browse players by gamer tag, open a profile, grant/revoke
a player's insider access, and hard-delete a player (spec `0040`). A player who self-soft-deleted is
still listed, flagged "Deleted". No public admin signup; the root admin is env-seeded on boot.
