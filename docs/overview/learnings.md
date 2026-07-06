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

- **Place a module by the concern it owns, not the file you were editing.** Service-wide infra
  (the migration runner) and cross-domain rules (display-name validation) belong in neutral
  homes (`db/`, `validation/`), not inside the first domain that needed them (`accounts/`) -
  otherwise sessions and future domains pick up a wrong-direction dependency on accounts.
  (Feedback `0003`.)
