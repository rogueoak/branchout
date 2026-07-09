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
  report the natural completion condition (`collectAnswer` -> `allAnswered` over *connected*
  players) and let the engine close the phase after a short grace timer; count only connected
  players so a dropped device never holds the round open, and re-check phase/round/pause at fire
  time so a host advance, pause, or new round cancels a stale timer harmlessly. (Feedback `0015`.)
- **Arm a completion-triggered action at *every* event that can satisfy the condition, not just the
  obvious one.** The auto-advance was armed only on `submitAnswer`, but a *disconnect* also completes
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

## Client-server contracts

- **A service that a browser will later consume must project outward the reads that consumer needs -
  the caller's own identity in a resource, every host action the UI offers, and the state the UI
  renders - not just the writes and the server-to-server calls.** An engine capability (`advance`)
  or a value held only in server state (the disputers list) is invisible to a front end until a
  route or a wire field exposes it, and an identity kept in an httpOnly cookie cannot be echoed by
  client code. When a server spec precedes its UI, budget a read surface for that UI. Building the
  Trivia web client on `0006`/`0007` surfaced four such gaps at once. (Feedback `0010`.)

## Deployment and infra

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
