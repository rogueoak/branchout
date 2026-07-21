# 0040 - RoomsHome "setup timeout" test flake aborted a prod deploy

`apps/web/app/rooms/RoomsHome.test.tsx` > "times out of the setup screen to a retry-able landing
when the create stalls (review #138)" intermittently failed with
`TestingLibraryElementError: Unable to find an accessible element with the role "alert"`. It failed
CI on an unrelated PR (#162) and aborted the #169 prod deploy. `release.yml` runs the web test
suite before it deploys, so a flaky web test is not a nuisance - it is a release blocker: a red run
skips `build`/`deploy` and prod stays behind `main`.

## Symptom

The test drives a deep-link auto-create that STALLS (`createRoom` returns a never-resolving
promise), then expects the 8s safety timeout to drop the host to the retry-able landing with a
`role="alert"` message. It advanced fake timers and then asserted synchronously:

```ts
vi.useFakeTimers();
vi.mocked(roomApi.createRoom).mockReturnValue(new Promise(() => {}) as never);
render(<RoomsHome viewer={{ signedIn: true }} initialGame="liar-liar" />);
await vi.advanceTimersByTimeAsync(8000);
expect(screen.getByRole('alert').textContent).toMatch(/taking longer than expected/i); // flaked
```

Passed almost always locally (0 failures in 50 back-to-back runs), failed rarely under CI's
parallel-worker scheduling pressure.

## Root cause

Two writers touch the component's `error` state, and the test did not order them:

1. the deep-link **auto-create** path (`runCreate`) calls `setError(null)` the moment identity
   resolves (fake-clock ~0), then awaits the never-resolving `createRoom`;
2. the **8s safety timeout** calls `setError('This is taking longer than expected...')` at 8000ms.

Under React 18's `createRoot`, a `setState` fired from a timer/promise callback OUTSIDE `act` is
committed on the Scheduler's MessageChannel (a macrotask) - which `vi.advanceTimersByTimeAsync`
(fake timers + a microtask drain) does not deterministically flush. So the DOM the synchronous
`getByRole('alert')` observed depended on whether the auto-create's `setError(null)` commit had
landed yet: usually the timeout message was showing (pass), occasionally the un-flushed
`setError(null)` had reverted to the spinner (no alert -> fail). The "An update to RoomsHome inside a
test was not wrapped in act(...)" warnings in the run output were the tell.

The component is correct: in real use the two writes are ~8s apart, so they never race. The race is
an artifact of the test compressing time while leaving React's commits unordered.

## Fix (test-only)

Drain the two writers in explicit order, each inside `act` (in the act environment
`@testing-library/react` sets, React flushes commits synchronously via microtasks, not the
MessageChannel - so nothing is left un-flushed to race):

```ts
render(...);
// 1) flush identity resolve + auto-create kickoff (enters the creating state, error -> null)
await act(async () => { await vi.advanceTimersByTimeAsync(0); });
// 2) run out the setup safety timeout so its message is the unambiguous LAST write to `error`
await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
expect(screen.getByRole('alert').textContent).toMatch(/taking longer than expected/i);
```

The assertion is unchanged in strength - it still proves the alert appears with the timeout copy.
The other `role="alert"` test in the file ("auto-create fails") already used real timers +
`await findByRole('alert')` and was never flaky, so no other test in the file shared the pattern.

Determinism proven: the single test passed 40/40 back-to-back and the full file passed with zero
"not wrapped in act" warnings.

## Learning

Rolled into `overview/learnings.md`: a flaky web test is a deploy blocker (release runs the suite
before deploying), and any timer-driven UI assertion under fake timers must order its state writes
inside `act` rather than advancing and asserting synchronously.
