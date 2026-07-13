# Learnings

Capture durable lessons as they emerge.

## Node services

- **Wire an `error` listener on every long-lived `EventEmitter` when you wire its happy-path
  events.** A `ws` socket, stream, or client with no `error` listener crashes the whole process
  on one emitted error. Handle failure and success at the same time, not as a follow-up.
  (Feedback `0001`.)

## Brand assets

- **Inline SVG exports through tsup's text loader avoid runtime `fs` dependencies in
  browser-consumed packages.** Using `loader: { '.svg': 'text' }` in tsup config embeds SVG
  content as string literals at build time; the built JS is portable and works in Next.js
  without webpack SVG plugins or runtime file-system access. A matching vite plugin
  (`transform` returning `export default JSON.stringify(content)`) keeps vitest green
  without a separate build step. (Spec `0003`.)
- **Place generated rasters in `dist/` then copy to `public/` in the same build script.**
  Turborepo's `outputs: ["dist/**"]` tracks brand rasters through the cache; a single
  `generate-rasters.mjs` that both generates and copies keeps the pipeline simple and
  ensures web always has fresh files after `pnpm build`. (Spec `0003`.)
- **Keep card text in the SVG's system-font stack; the `sharp` pipeline embeds no fonts.**
  Composing OG cards with `sharp` renders any `<text>` via librsvg's fallback font - there are no
  font files in the pipeline. Set the same `-apple-system, ... , sans-serif` stack the wordmark
  SVG uses (rather than a bespoke web font) so text rasterizes consistently. (Spec `0025`.)
- **A game mark is a sibling of the house icon, not a reskin.** Reuse the icon skeleton (radial
  tile, two-pass spark strokes, party leaf nodes, and the single gold root) and express the game
  by *bending the branch graph* - Trivia into a question mark, Liar Liar into a masquerade mask.
  The gold-root rule holds for every mark; assert `#d2a463` is present in a test. (Spec `0025`.)

## Toolchain

- **Pin the runtime to what the toolchain actually requires, not an aspirational lower bound.**
  `pnpm@11.8.0` needs Node >= 22.13; a local Node that is newer than CI hides the mismatch until
  CI fails. When mirroring another repo's versions, confirm the combination runs on the target
  Node. (Feedback `0002`.)
- **Run `tsc` in CI even when the bundler does not type-check.** `tsup`/esbuild strip types
  without checking them, so a service type error passes `build` and merges undetected unless a
  dedicated `typecheck` step runs `tsc --noEmit`.
- **The `dev` turbo task needs `dependsOn: ["^build"]` too, not just `build`.** A consumer that
  imports a generated artifact (e.g. `apps/web` importing `@branchout/theme`'s built `brand.css`)
  fails on a fresh-clone `pnpm dev` if the producing package was never built - CI's `pnpm build`
  hides it because only `build` declared `^build`. Whatever the build generates, dev must generate
  first. (Spec `0002`.)

## Theming

- **The AA guard is the arbiter of a brand's ramp steps - author the anchors, then let the build
  correct them.** A hand-picked "hot pink" (bubblegum.500) or a green.600 success under white text
  fails WCAG AA; deepen the fill one ramp step (never rename the role) until `buildBrand()` passes.
  Confetti nudged secondary 500 -> 600, success 600 -> 700, and info 600 -> 700 in light for
  white-text AA, and dark primary-active 500 -> 400 (violet .500 is too dark under a near-black
  primary-foreground). (Spec `0002`.)
- **`buildBrand()` forbids a dark override identical to its light value (except
  `accent-foreground`), so a role that is visually theme-invariant still needs two distinct steps.**
  The spec's "accent sunbeam.400 in both themes" and a shared warning-foreground both tripped the
  copy-paste guard; Confetti split them (dark accent -> a brighter sunbeam.300, dark
  warning-foreground -> honey.900). When a role reads the same in both themes, pick adjacent steps
  that both clear AA - and lean the split toward the brand mood (brighter in dark for a "fun"
  accent) rather than fighting the guard. (Spec `0002`.)
- **Name functional primitive ramps differently from the semantic roles they feed.** A DTCG token
  can't be both a group and a leaf, so `color.success` the role and `color.success.600` the
  primitive collide in Style Dictionary. Confetti's functional ramps are `clover`/`honey`/`cherry`/
  `lagoon` feeding `success`/`warning`/`danger`/`info`. (Spec `0002`.)
- **Canopy ships its components without a `use client` directive, so the consumer owns the client
  boundary.** Canopy's `twigs` (Card) calls `React.createContext` at module scope; imported into an
  App Router Server Component it prerenders with `createContext is not a function`. Wrap canopy
  usage in a `'use client'` component. (Spec `0002`.)

## Testing

- **A test exists for each acceptance criterion, including the failure partitions and the
  user-facing surface, not just the happy path.** Prove the degraded/error branch and assert the
  styling or output a user actually sees; `getByRole(...)` already throws on a miss, so a
  trailing `toBeDefined()` asserts nothing.
- **A test named for a guarantee must exercise that guarantee end to end.** An idempotency test
  that stops before the retry, or a "reports on retry" test that never re-delivers, proves
  nothing; drive the failure path through to the observable outcome. (Feedback `0003`.)
- **Test a majority/quorum rule at a roster size where the wrong denominators diverge.** A vote
  over N others with threshold `agrees*2 > N` gives an identical verdict for "other players" vs
  "ballots cast" vs "all players" when N=2, so a 3-player dispute test proves nothing. Pick a
  size (odd, >= 3 others) where each candidate denominator yields a different verdict - the
  Trivia dispute rule was only honestly pinned once tested on 4-5 players. (Feedback `0004`.)
- **A real-stack e2e catches wiring bugs no unit or in-memory-integration test can.** Building
  the Playwright harness surfaced that the join page's OG `generateMetadata` (SSR) fetched the
  control-plane through the browser's `NEXT_PUBLIC_CONTROL_PLANE_URL` - a relative `/api` in prod
  and a container-local `localhost` in Docker - so the per-game share card only ever worked in
  local non-Docker dev and silently fell back everywhere else. Server-side fetches need the
  server-side URL (`CONTROL_PLANE_URL`), the split `lib/session.ts` already used; the e2e is what
  proves the tags a crawler actually receives. Drive the real stack for anything whose behavior
  only emerges when the services are wired together. (Spec `0026`.)
- **Keep e2e out of the fast test loop.** The Playwright package exposes an `e2e` script, not
  `test`, so `turbo run test` never needs Docker; e2e runs as its own CI job. A dedicated compose
  project (`branchout-e2e`) on shifted ports lets a run coexist with a developer's dev stack.
  (Spec `0026`.)

## Services and state

- **Model an ephemeral session's end state as reusable, not terminal-and-forgotten.** A session
  keyed by a stable id (room+game) that ends in a `complete` blob with no TTL wedges re-entry:
  the "already exists" guard keeps refusing a fresh start forever. Give the end state a TTL and
  let the entry point restart over it. (Feedback `0003`.)
- **At-least-once reporting needs an outbox, not just a dedupe key.** A stable id (`roundId`)
  makes a retry safe, but something has to actually retry - dedupe alone turns a transient
  downstream failure into silent loss. Queue the failed report and flush it on the next event.
  (Feedback `0003`.)
- **Validate identity fields that compose into keys/channels against a bounded charset at the
  boundary.** Non-empty-string checks are not enough when the value is concatenated into
  `stream:room:game` or `room:game:runId:round`; an embedded separator collides distinct
  sessions or reports. (Feedback `0003`.)
- **Prune an ephemeral session's per-round scratch to the round in play.** State the engine
  persists and deep-clones every frame must not accumulate rounds it never reads again, or the
  Redis blob and per-frame clone cost grow with game length. Trivia keeps only `usedIds` and the
  current round's working state, resetting the per-round maps in `startRound`. (Feedback `0004`.)
- **A vote/quorum denominator should count only *connected* eligible voters.** In a live game
  where devices drop, dividing by the whole roster treats an offline player as an implicit "no"
  and can make a legitimate majority unreachable; gate on `connected`. (Feedback `0004`.)
- **A soft-delete that frees the unique keys makes the row unfindable by those keys - split the
  read paths, don't filter one.** Soft-deleting an account (spec `0040`) tombstones the
  unique-constrained columns (email, normalized gamer tag) so a departing player can re-register,
  but that means an admin search *by the old tag* no longer matches the deleted row (it lists only
  under a browse). Keep the display columns for identification, and give the operator read path its
  own method (`getByIdForAdmin` / an unfiltered list) rather than making one `getById` both hide
  deleted rows from players and show them to admins - a single flag-checked path serves neither well.
  Same rule let sessions self-heal: once `getById` refuses a deleted row, the existing `/auth/me`
  self-revoke logs the stale session out, so no Redis scan is needed. (Spec `0040`.)
- **Purge only the departing entity's *own* data; leave shared history.** Hard-deleting an account
  cascades its per-account rows (`account_game_plays`) but must not delete the rooms it hosted:
  `room_games`/`room_rounds` hold the recorded history of *every* participant, so purging them to
  clean up one host erases other players' records (and the missing `ON DELETE CASCADE` would fault
  the delete anyway). A dangling `host_account_id` (no FK, transient rooms) is the lesser evil.
  (Spec `0040`.)

## Auth and security

- **Build the adversarial and degraded partitions with the happy path, not after.** For auth
  specifically: keep credential checks constant-time (verify against a dummy hash on an unknown
  user so latency does not enumerate accounts), never let a hash silently truncate input (bcrypt
  ignores bytes past 72 - pre-hash with SHA-256), and fail fast on un-healable startup state (a
  failed migration must abort boot, not serve 500s while `/health` reports the DB "ok"). These
  were all caught in persona review of `0004`, not by the passing happy-path tests. (Feedback
  `0003`.)
- **A money endpoint must fail closed, and a dedupe key is not a transaction.** An unset internal
  secret should reject in production (open only by explicit dev opt-in), a bearer-token check is
  constant-time, and a debit gated behind a "recorded" flag loses the charge when the two
  non-transactional awaits split on a crash - debit unconditionally under an idempotency key so a
  retry both bills once and heals a prior failure. (Feedback `0004`.)

- **A link crawler has no session and is not a member - server-render metadata needs a public
  read, not the member-gated one.** Open Graph unfurls are fetched by bots with no cookie, so a
  join page's `generateMetadata` cannot reuse a member-only `getRoom`; it needs a purpose-built
  public endpoint that returns only what the unfurl needs (here `{ code, status, selectedGame }`)
  and nothing private. Keep that projection minimal and assert in a test that member/session
  fields never appear, so a later change cannot widen it into a leak. (Spec `0025`.)

## Module boundaries

- **A privilege that is orthogonal to a role is a flag, not a role.** Modeling the host as a third
  `role` ('host' | 'player' | 'observer') forced every "is this a participant" site to special-case
  it, and quietly excluded the host from the roster/standings the whole time. Collapsing it to a
  boolean (`isHost` on a `'player'` member) let the host flow through the existing player machinery
  untouched while the flag localizes the admin concern (controls, kick, sessionId visibility) to the
  few sites that actually differ. Prefer a flag when the extra state is independent of the enum it
  was crammed into. (Spec `0013`.)
- **When a create path sets an invariant flag, every re-entry path must preserve or re-derive it -
  from the authoritative source, not the request.** `createRoom` set `isHost: true`, but the
  rejoin-through-`join` path rebuilt the member and hardcoded `isHost: false`, so a host re-entering
  (even as an observer) was demoted out of the roster while Postgres `hostAccountId` still authorized
  it - breaking `isHost => role === 'player'`. Re-derive the flag in `join` from the room
  (`session.accountId === room.hostAccountId`) rather than trusting `input`. A caller can shape the
  request; they cannot shape the authoritative record. (Review `0013`.)
- **Place a module by the concern it owns, not the file you were editing.** Service-wide infra
  (the migration runner) and cross-domain rules (display-name validation) belong in neutral
  homes (`db/`, `validation/`), not inside the first domain that needed them (`accounts/`) -
  otherwise sessions and future domains pick up a wrong-direction dependency on accounts.
  (Feedback `0003`.)

## UI and CTAs

- **A content-bearing "card as a button" must not reuse the button recipe - it inherits
  `white-space: nowrap` and won't wrap.** Wrapping a detail card in a `<button>` styled with
  `buttonVariants()` pulled in the button base's `white-space: nowrap`, which (being inherited)
  forced the card's multi-sentence summary onto one line and blew past the phone viewport (631px on a
  ~413px screen). The card already owns its hover/selected styling, so the clickable wrapper needs only
  a minimal reset (full width, left-aligned text, a focus ring) - not the whole button recipe. Reach
  for `buttonVariants()` on actual buttons (short, single-line labels), not on wrappers around
  flowing content. The phone-viewport e2e caught this where every unit test (jsdom has no layout)
  passed - a real-browser overflow guard earns its keep. (Spec `0029`.)
- **A flex row holding a user-controlled string needs `min-w-0` on the text column and a word-break,
  or a long space-less value overflows the phone.** An avatar-plus-name header (`flex items-center`)
  overflowed at 360px because the nickname defaults to the gamer tag - a long, space-less identifier -
  rendered at `text-h2` in a flex child that, by default, refuses to shrink below its content width and
  a no-space word won't wrap. Add `min-w-0` to the flex text column (so it can shrink) and `break-words`
  to the heading (so the unbreakable token wraps). Any header that shows a name/tag/email a user can set
  needs this. The profile e2e caught it; the unit tests (no layout) did not. (Spec `0027`.)
- **Prevent iOS input-zoom by sizing the field >= 16px, never by disabling zoom.** iOS Safari
  auto-zooms a focused form control whose font-size is under 16px, and canopy inputs render
  `text-sm` (14px). The one-line temptation - `maximum-scale=1` / `user-scalable=no` on the viewport
  - breaks pinch-zoom for low-vision users; the correct fix is a 16px font-size on the control (on
  touch devices via `@media (pointer: coarse)`). And because the offending size is a *utility class*
  (`text-sm`, specificity 0,1,0), the override needs matching specificity: `input:not([hidden])`
  (0,1,1) wins, a bare `input {}` (0,0,1) silently loses the cascade. (Feedback `0016`.)
- **A phase change that swaps the primary content should scroll it into view.** When the app
  replaces what the player is looking at without a navigation - a new question landing while the
  viewport is still scrolled down on the prior reveal/leaderboard - the old scroll position is
  stale. Scroll to the new content on the transition (an effect keyed on the round, guarded to the
  answering phase). (Feedback `0016`.)
- **Give a secondary element emphasis through a badge, ring, or border - not a second `primary`
  button.** On a view with a designated primary CTA (a marketing hero, a form's submit), a
  `primary` variant used to say "look here too" (a "popular" pricing tier) becomes a second
  primary action and breaks the one-primary-per-view rule, flattening the real CTA. Rank options
  with a `Popular` badge + `ring`/border and keep their buttons `secondary`/`outline`.
  (Feedback `0005`.)
- **A server component that renders canopy `twigs` (Card) needs `'use client'`, and the file
  should say why.** Canopy ships components without a `use client` directive and Card calls
  `React.createContext` at module scope, so the consumer owns the boundary (see Theming). When
  you add the directive, add a one-line comment naming the dependency that forces it, so the next
  reader does not "optimize" it away and break the build. (Feedback `0005`.)
- **Prefer a native control over a portalled Radix one when the picker is a plain enum.** Canopy's
  `Select` is Radix-backed (a portalled listbox driven by pointer events) and does not render its
  options in jsdom without an elaborate userEvent setup, so it is both harder to test and heavier
  than the job needs. A native `<select>` styled with canopy's `inputVariants()` recipe stays on-
  theme (no hardcoded colors), keyboard/screen-reader accessible, and testable with
  `getByLabelText` + `fireEvent.change`. Reach for the compound component only when you need its
  custom rendering. (Spec `0010`.)
- **A device-aware default must not silently break a gate; the blocked-state copy must tell the
  actor how to self-fix.** Defaulting a phone host to `remote` (not a viewer) let a solo/all-phones
  party hit the "at least one viewer" start gate showing "Waiting for a viewer to join" - misleading,
  since the host could fix it by switching itself to Interactive. Make the blocked copy aware of the
  actor: when the caller is the one who can lift the gate, point at their own control instead of
  telling them to wait. (Review `0013`.)
- **On a mobile-first surface with a desktop path, "follow the pointer" is not the same input on
  touch and mouse - gate press-drag vs. hover explicitly.** Teeter's canvas aim let the piece follow
  every `pointermove` over the board. On touch that is only ever a press-drag, so it played right on a
  phone; on a mouse it also fires on a bare hover, so travelling the cursor to the on-canvas Stop-spin/
  Drop button re-aimed the piece to that top-right corner right before the drop - a high drop that
  instantly cleared the level. Track a `dragging` flag (true on pointer-down, false on up/cancel) and
  ignore moves while it is unset; a tap still positions, a drag still tracks, a hover is inert. Verify
  the responsive path with a *real mouse moving to the controls*, not only the phone - the bug was
  invisible to touch playtesting and to jsdom (which also drops synthetic-pointer clientX/Y). (Feedback
  `0023`.)

## Live game state and the seam

- **A frame you only ever *stream* is invisible to anyone not subscribed the instant you send it.**
  The engine published the Trivia `prompt` at start - before any device had opened its socket - so
  it was lost for everyone, and `join` returned a `state`-only snapshot with no way to recover the
  question. Persist the current phase's frames (`prompt`/`reveal`/`standings`) in the session and
  replay them as ordered catch-up on `join`; a late joiner or reconnecting device must reconstruct
  the current phase from stored state, not from a publish it missed. (Feedback `0014`.)
- **A field wired end to end can still die at the validator in the middle.** `isHost` had a
  matching type, sender, and reader, yet was `false` everywhere because the ingress parser
  (`parseStartHandoff` -> `requirePlayers`) rebuilt each player field-by-field and never copied it.
  When you add a field to a message, add it to the *parser* too and pin it with a round-trip test
  through the actual validator - the seam, not just the two ends. (Feedback `0014`.)
- **A convenience mock that is easier to type than the real payload hides decoder bugs.** The web
  prompt test used `difficulty: 5` (a number) while the engine sends a tier *string*; the decoder
  rejected every real prompt and the UI showed nothing, yet the test stayed green. Mock the shape
  the producer actually emits (copy a real frame). (Feedback `0014`.)
- **A client that flips state off its own action must also detect the same flip driven by another
  peer.** The room went `running` inside the host's start handler, so only the host advanced; every
  other device had no read to observe it and sat in the lobby forever. When one peer's action
  changes shared state, give the others a poll or a push to detect it - never assume they ran the
  same code path. (Feedback `0014`.)
- **"The message arrives" and "the UI updates" are two assertions.** The engine delivered the
  prompt (provable at the socket) while the screen stayed blank, because the decoder dropped it.
  For a player-facing flow, test through to the rendered surface, not just the wire. (Feedback
  `0014`.)
- **When the bug is client-side, the fix's test must exercise the client - not just the server
  surface the client needed.** Bug #3 was the web client never polling room status, yet the first
  cut tested only the new `GET /rooms/:code` and `service.view`; the actual lobby<->game transition
  stayed unproven and a revert would keep every test green. Add the test at the layer the bug lived
  on (a `RoomClient` render/poll test), covering both transition directions. (Review `0014`.)
- **A blocked/paused state that has more than one cause needs copy honest to every cause.** "Paused
  by the host" was fine for a deliberate pause but misleading once a host *disconnect* also set
  `paused` - it read as a permanent, deliberate stop with no hint of resumption. When the client
  cannot distinguish the causes, write neutral copy true for all of them ("waiting for the host")
  and keep it in one place, not duplicated per layout with drifting wording. (Review `0014`.)
- **A phase that can end by consensus needs a consensus signal, not just a host tap or a timer.**
  The engine advanced the answer round on a host tap or the dispute-window timer, but had no read
  for "everyone has answered", so a finished table sat in `collecting`. Give the module a way to
  report the natural completion condition (`collectMove` -> `allSubmitted` over *connected*
  players) and let the engine close the phase after a short grace timer; count only connected
  players so a dropped device never holds the round open, and re-check phase/round/pause at fire
  time so a host advance, pause, or new round cancels a stale timer harmlessly. (Feedback `0015`.)
- **Arm a completion-triggered action at *every* event that can satisfy the condition, not just the
  obvious one.** The auto-advance was armed only on `submitMove`, but a *disconnect* also completes
  the round (the leaver was the last one it waited on) - so a drop-instead-of-answer left the round
  hanging. When "everyone is done" drives an action, evaluate the predicate on every state change
  that can flip it (answer *and* disconnect), and make the fire-time guard include `runId` so a
  restart's reused round number cannot let a stale timer fire on the fresh run. (Engineer review of
  PR #25, feedback `0015`.)
- **Send a countdown as *remaining time*, not an absolute deadline, so the client anchors it to its
  own clock.** A shared timer that ships an epoch deadline is only as correct as the gap between the
  server and client clocks (which can be minutes). The engine holds an absolute deadline internally
  (deterministic under an injected `clock` seam) but the `state` frame projects `answerMsRemaining`;
  the client sets `localDeadline = Date.now() + remaining` on receipt, so skew never leaks in and a
  reconnecting device gets the true time left because `join` resends a fresh remaining. (Spec `0017`.)
- **A rescheduled timer should self-correct against the source of truth, not trust its own delay.**
  Pausing pushes the answer deadline out, but a timer armed before the pause still fires at its
  original wall time; cancelling handles need an in-memory map (state is Redis-serialized, no
  functions). Instead the fire re-reads the current deadline: if time is left it re-arms for exactly
  that, and only advances once the deadline has truly passed - so a stale timer becomes harmless
  without any cancel bookkeeping. (Spec `0017`.)
- **When a control needs to express a *range*, model the data for a range - don't overload one
  scalar over a coarse enum.** Trivia difficulty was one 1-10 knob mapped to a blend of three tiers,
  so it could never say "consistent middle": the fix was to re-rate the questions on a real 1-10
  scale and let the host pick a min-max range, not to add more blend rows. Re-rating 1600 rows was a
  merge-by-id textual swap so only the `difficulty` field changed (the diff stayed reviewable), and
  the wire/UI followed the data (numeric prompt rating, dual-thumb slider). The knob's expressiveness
  is bounded by the granularity of the data underneath it - grow the data first. (Spec `0016`.)
- **Store the canonical form; compute the display form at the view - never make storage carry
  presentation.** Trivia answers are stored lowercase because matching is case-insensitive; the
  fix for shouty display was a title-case transform in the viewer, not a data change or a second
  stored field. It is best-effort by nature (casing reconstructed from lowercase cannot recover
  `CO2`/`iPhone`), and the dispute vote remains the human fallback. A control that only makes sense
  with other participants (Dispute) gates on the live *connected* count from the roster the client
  already holds, not on the local player's state alone. (Feedback `0015`.)
- **A continuously-stepped physics world must gate a measurement on "at rest", and gate on the WHOLE
  scene, not per body.** Teeter's tower height was `min(bounds.min.y)` over all placed bodies each tick,
  so a piece in free-fall counted at its airborne arc peak - a drop above the goal line won instantly,
  and the min-drop line jumped as it fell (score, level-clear, and the streamed line all read that
  height). First fix (feedback `0025`): count a body only when its linear + angular speed is below a
  threshold. That killed the airborne peak but not a TUMBLE - the settled subset itself changes as bodies
  fall in and out of "at rest", so the height/line still jumped mid-tumble. Real fix (feedback `0026`):
  keep a HELD `stableHeight` and refresh it only when the WHOLE scene is at rest (`every` body below the
  threshold); everything reads the held value, so nothing resolves a new height until the tower actually
  settles. A just-placed body is stepped once under gravity before the check, so it never settles the
  height at its release point. Decide *when* a number is valid to read, and whether "settled" means one
  body or the whole scene. (Feedback `0026`, first flagged in `0024`.)
- **An input guard added for one layout becomes wrong when the layout changes.** Teeter added a
  drag-guard (only re-aim on a press-drag, never a bare hover) because the aim button sat ON the canvas -
  a mouse travelling to it dragged the piece to that corner (feedback `0023`). Once the button moved
  ABOVE the canvas (feedback `0025`), a mouse leaving the board could no longer drag the piece, so the
  guard only blocked the wanted behavior (hover-to-aim). Removing it restored mouse aiming (feedback
  `0026`). When you move a control, revisit the guards that existed only to protect its old position.

## Client-server contracts

- **A service that a browser will later consume must project outward the reads that consumer needs -
  the caller's own identity in a resource, every host action the UI offers, and the state the UI
  renders - not just the writes and the server-to-server calls.** An engine capability (`advance`)
  or a value held only in server state (the disputers list) is invisible to a front end until a
  route or a wire field exposes it, and an identity kept in an httpOnly cookie cannot be echoed by
  client code. When a server spec precedes its UI, budget a read surface for that UI. Building the
  Trivia web client on `0006`/`0007` surfaced four such gaps at once. (Feedback `0010`.)
- **When one fact has a durable and an ephemeral representation, the return/reconnect path must
  re-derive it from the durable one, not gate on the ephemeral.** A room's host is durable
  (`rooms.host_account_id` in Postgres) but its roster row is ephemeral (Redis, 12h TTL), and the
  client remembers its seat only in per-tab `sessionStorage` (cleared when the tab closes). A host
  returning after a stretch was bounced to the join screen and "lost" host: `view()`/`members()`
  gated purely on the Redis row, and the client rendered the join prompt without ever asking the
  server whether the account already owned the room. The fix re-seats the durable host on read
  (`resolveCaller`) and adds a `GET /rooms/:code/me` resume the client calls before falling back to
  join. Rule: every place presence can expire needs a path that rebuilds it from the system of
  record; and a state that lives only in `sessionStorage` is forgotten on tab close, not just after a
  TTL - treat "the client forgot" and "the server expired" as two distinct recoveries. (Feedback
  `0021`.)

## Deployment and infra

- **Don't gate growing content on a fixed count or spread - validate item structure, not the
  collection's shape.** The Trivia/Liar Liar banks carried a total-count, per-category-count, and
  difficulty-spread gate. Content grows over time and its spread is deliberately uneven, so those
  gates only fight the content: a valid new question fails CI for being the 201st, and a re-rate that
  legitimately clumps a category trips the spread check. Keep the checks that stop a *malformed item*
  from crashing the engine (id format + uniqueness, required fields, bounded values, no duplicate
  prompt in a category) and drop every check on the collection's size or distribution. A validator
  named for structure must run on a bank of any size. (Spec `0041`.)
- **Pull a second private source onto the box with a repo-scoped read-only deploy key, and make the
  sync best-effort.** The box needs the private game-data repo but should not carry a broad,
  long-lived credential. A **read-only deploy key** (org deploy keys enabled) scoped to that one repo
  via a `github-data` SSH alias (`IdentitiesOnly yes`) lets the box `git fetch` the data and nothing
  else, with no cross-repo token. Pin the content by a git tag in a version file so it rolls back with
  the code. Keep the sync **best-effort** (on fetch/checkout failure, keep the last-good checkout and
  continue) so an unrelated app deploy is never blocked on the data pipeline. (Spec `0041`.)
- **A "pull the pinned ref" sync must FORCE and CLEAN, not plain-checkout.** The first real promote
  bumped the data version but the box stayed on the old tag: a stray untracked file on the box
  collided with a tracked file in the target tag, so `git checkout --detach` aborted - and because
  the sync is best-effort, it warned and kept the old data (a green deploy running stale content).
  A box-side working tree drifts (leftover files, partial writes), so a re-sync must be idempotent
  against any tree state: `git fetch` then `git clean -fd` then `git checkout -f --detach <tag>` -
  the same hard-reset robustness branchout's own self-sync already uses (`git reset --hard`). Pair
  best-effort with force: silently-keep-last-good hides a wedged sync unless the checkout can't fail
  for an avoidable reason. (Spec `0041`.)
- **A read-only bind mount from a host path is docker-rollout-safe; a mount that both instances read
  is fine to double.** Serving game data from a `:ro` host bind mount works with the zero-downtime
  swap because the path is identical and read-only on both Compose-indexed instances - nothing to
  reconcile when they overlap. Reserve the "never roll this" treatment for stateful single-volume
  services (Postgres/Redis), not for a shared read-only mount. (Spec `0041`.)

- **A zero-downtime claim must account for every connection, not just the ones through the load
  balancer.** Making Caddy follow a docker-rollout swap (dynamic upstreams) only covers the
  edge-fronted routes. The internal service-to-service hops (`web` SSR -> `control-plane`,
  `control-plane` -> `game-engine`) bypass the balancer and see a one-off keep-alive re-dial blip;
  in-flight WebSocket sessions on the rolled service drop and must reconnect. Enumerate every
  connection and state which are seamless, which blip-and-retry, and which drop-and-reconnect - do not
  let "the proxy follows the swap" stand in for the whole system. And verify through the path a user
  actually takes (hammer every drop-free upstream during the rehearsal), not out-of-band. (Feedback
  `0018`.)
- **A rolling deploy's compatibility window is bounded by the strictness of its version check.** With
  a strict-equality gate (`assertVersion` throws on `!== PROTOCOL_VERSION`), a one-service-at-a-time
  roll is safe only for *optional fields added under the same version*; bumping the version at all is a
  hard cutover that needs an expand/contract (dual-version) deploy. State that boundary precisely
  rather than hand-waving "relies on the versioned envelope + additive fields". (Feedback `0018`.)
- **Compose relative paths resolve against the compose file's directory, not the shell's cwd.**
  `env_file`, build `context`, and bind-mount sources are all anchored to the directory the
  compose file lives in (or `--project-directory`), regardless of where you run `docker compose`.
  A deploy that wrote `.env.prod` to the repo root while `compose.site.yml` sat in `deploy/docker/`
  would have started every service with empty secrets. Write host-side env files next to their
  compose file. (Feedback `0011`.)
- **Keep a tier off any network it has no need to reach - the web tier does not belong on the data
  network.** The web app reaches the API tier over the shared `edge` network, so joining it to the
  internal `db` network only hands a compromised web container direct TCP to Postgres and Redis.
  The cheapest segmentation win is refusing the unnecessary network membership. (Feedback `0011`.)
- **Pass deploy secrets over SSH stdin, not on the remote command line.** Interpolating a secret
  into the SSH command argument puts it in the remote command that sshd can log at VERBOSE/DEBUG
  and breaks on a quote in the value. Stream `printf %q` export lines plus the script body through
  `... | ssh host bash -s` so secrets stay off argv and are safe for any value. Pair GHCR
  `docker login` with a `trap '... logout' EXIT` so credentials never linger on a failed run.
  (Feedback `0011`.)
- **A new field on a versioned envelope is optional-and-defaulted unless you bump the version.**
  The version stamp exists so a shape can grow without breaking older peers; adding a *required*
  field under the same version voids that guarantee - a peer predating the field passes the version
  gate yet omits it, and a reader that trusts its presence crashes (a required `disputes` on the
  `state` recovery frame would `undefined.filter` on any pre-field engine). Add it optional, default
  its absence at the read boundary (`frame.x ?? default`), and reserve a version bump for a genuinely
  breaking change. (Feedback `0011`.)
- **A browser-facing service echoes the public identity a UI needs, never the secret that
  authenticates the caller.** Give a resource member two ids: the httpOnly session token stays
  server-side (auth, kick/rejoin key, host-only), and a separate public token (unguessable, minted
  beside it) is what the roster, the wire frames, and the UI key on. Returning the public id on join
  and in the members list lets a non-host device act without ever exposing the session token - and
  keying the engine roster on the public id (not the session id, which the engine already broadcast)
  removed a prior leak. (Spec `0012`.)

## Testing the seam

- **Test the mapping at a seam, not just its two ends.** When one value must equal another across a
  boundary - the engine handoff roster key must be the id `join` returned to the device, not a
  different id on the same member - assert that equality directly (`engine.starts[0].players[i]` is
  the member's `playerId`, and is NOT the `sessionId`). Testing "an id is minted" and "the engine
  accepts an id" separately leaves the load-bearing "it is the *right* id" line free to be reverted
  with the whole suite still green. (Feedback `0011`.)
- **A rule-2 end-to-end must assert the user-visible outcome, not just the handoff input.** The
  "host reaches the engine" test stopped at `engine.starts[0].players` (the input seam), so a
  regression that carried the host into the roster but dropped it from the final standings - earning
  no stars - stayed green. Drive the flow through to the scored result (host ranked first ->
  `recordGameComplete` -> the persisted stars award) so the outcome the player sees is what breaks.
  (Review `0013`.)
- **When two sides of a seam must use the same path/key, make them one shared constant - don't rely
  on a test hoping they match.** The engine reporter POSTed to `/rounds` while the control-plane intake
  served `/engine/rounds`, so every report 404'd in prod (where `CONTROL_PLANE_URL` is set); local/e2e
  left it unset (NoopReporter) so it never surfaced. Each end had its own test, neither asserting the
  two literals were equal. The fix was a shared `ENGINE_ROUNDS_SUBPATH`/`ENGINE_COMPLETE_SUBPATH` in
  `@branchout/protocol` that both the route registration and the reporter derive from - correct by
  construction, which beats a seam test because it removes the failure mode rather than detecting it.
  Also: a silent path mismatch hides when the failing path is a fire-and-forget report and the
  test/dev env disables the caller; exercise the real caller against the real route. (Feedback `0017`.)

## Subdomain surfaces

- **A shared chrome component on a rewrite-based subdomain surface emits host-relative links that
  404.** The insider surface (`insider.`) is one `web` process that middleware rewrites into an
  `/insider` tree; the reused `TopNav`/`Footer` link `/games`, `/privacy`, etc., which on that host
  resolve into the gated tree (only the index exists) and 404 - a dead end a tester hits on the happy
  path. Cross chrome links to the apex (pass an apex `linkOrigin`); keep surface-owned content
  relative. And a gate that redirects across hosts must carry an **origin-validated** return target
  (`?next=`) and never build an absolute redirect from the inbound `Host` header - strip-only-the-label
  on an untrusted `Host` is a latent open redirect. (Review `0035`, feedback `0019`.)

## Rate limiting and lockouts

- **A lockout key must anchor on the dimension the actor cannot forge.** The first auth limiter keyed
  login on `<email>:<ip>`, but `request.ip` comes from `X-Forwarded-For`, which Caddy *appends* to
  (never strips), so a client controls it - rotating XFF minted a fresh bucket per request and
  brute-forced past the lock. Mixing an unforgeable dimension (the account) with a forgeable one (the
  client IP) reduces the key to the forgeable part. Anchor on the account; treat a client IP as a
  best-effort *secondary* signal only, and say so. Hardening the IP means stripping/replacing XFF at
  the edge, not trusting it in the app. (Feedback `0020`, spec `0036`.)
- **A fixed-window counter built from `INCR` + `EXPIRE` must recover a lost TTL.** The window was set
  only on the first hit; a crash between the two ops left a counter with no expiry and permanently
  locked a real user (and `check` runs before `record`, so a blocked caller never re-arms it). Make
  `check` self-heal - a counter at/over the limit with `ttl < 0` is an anomaly to clear, not honor.
  (Feedback `0020`, spec `0036`.)
