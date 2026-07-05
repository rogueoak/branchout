# Learnings

Capture durable lessons as they emerge.

## Node services

- **Wire an `error` listener on every long-lived `EventEmitter` when you wire its happy-path
  events.** A `ws` socket, stream, or client with no `error` listener crashes the whole process
  on one emitted error. Handle failure and success at the same time, not as a follow-up.
  (Feedback `0001`.)

## Toolchain

- **Pin the runtime to what the toolchain actually requires, not an aspirational lower bound.**
  `pnpm@11.8.0` needs Node >= 22.13; a local Node that is newer than CI hides the mismatch until
  CI fails. When mirroring another repo's versions, confirm the combination runs on the target
  Node. (Feedback `0002`.)
- **Run `tsc` in CI even when the bundler does not type-check.** `tsup`/esbuild strip types
  without checking them, so a service type error passes `build` and merges undetected unless a
  dedicated `typecheck` step runs `tsc --noEmit`.

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
