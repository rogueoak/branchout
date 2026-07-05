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
