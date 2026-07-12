# 0042 - Generic turn-submission vocabulary: `answer` -> `move`

## Problem

The engine's turn machinery is game-agnostic: the wire frame carries an **opaque string** and each
game parses it however it likes (Trivia reads free text; a physics game would read
`{ angle, dropX }`). But the contract is *named* `answer` - `AnswerMessage`, `collectAnswer`,
`submitAnswer`, `answer_rejected`. That name privileges one game's mechanic and misleads anyone
adding a game whose turn input is not an "answer". As we add non-quiz games (spec 0043, Teeter
Tower), the misnomer becomes a real source of confusion in the shared code.

This is for developers extending the platform: the generic per-turn submission should read as a
generic **move**, while each game keeps its own domain words internally.

## Outcome

The generic turn-submission contract is renamed `answer` -> `move` end to end, with **no behavior
change**:

- Wire: client sends a `move` frame (`type: 'move'`, field `move`); server may reply
  `move_rejected`. `PROTOCOL_VERSION` is bumped.
- SDK: `GameModule.collectMove`, `allSubmitted?`, `ConfigureResult.moveWindowMs`.
- Engine: `submitMove`, `moveDeadline`, `armMoveWindow`, `moveRemainingMs`, `moveMsRemaining`.
- Web: `GameClient.submitMove`, `GameActions.submitMove`, `GameRemoteProps.onMove`,
  `GameState.moveMsRemaining`, reducer case `move_rejected`, `useMoveCountdown`.
- Trivia and Liar Liar implement `collectMove`/`allSubmitted` and their Remotes call `onMove`.

Trivia and Liar Liar keep their **domain** vocabulary untouched: a question's correct `answers`,
`correctAnswer`, and answer-matching stay as-is. Only the generic contract surface is renamed.

The separate `vote` channel (dispute/guess) is out of scope - it is renamed nothing here.

## Scope

**In:** rename of the generic turn-submission identifiers, wire frame types + string discriminants,
the `PROTOCOL_VERSION` bump, and every call site + test that references the old names.

**Out:** any logic change; the `vote` channel; game-internal domain "answer" wording; the new game
itself (spec 0043).

## Approach

Mechanical rename following a fixed token map (`AnswerMessage`->`MoveMessage`,
`AnswerRejectedMessage`->`MoveRejectedMessage`, `collectAnswer`->`collectMove`,
`allAnswered`->`allSubmitted`, `answerWindowMs`->`moveWindowMs`, `submitAnswer`->`submitMove`,
`answerDeadline`->`moveDeadline`, `armAnswerWindow`->`armMoveWindow`,
`answerRemainingMs`->`moveRemainingMs`, `answerMsRemaining`->`moveMsRemaining`, `onAnswer`->`onMove`,
message type strings `'answer'`->`'move'` and `'answer_rejected'`->`'move_rejected'`, the wire field
`answer`->`move`, and the `use-answer-countdown` hook/file -> `use-move-countdown`).

Because both games and their tests pass unchanged apart from the renamed identifiers, the existing
Trivia + Liar Liar unit and e2e suites are the proof the rename is behavior-preserving. Client and
server ship together in one release, so the `PROTOCOL_VERSION` bump has no cross-version concern.

## Acceptance

- [ ] No source reference to the old generic identifiers remains (domain `answers`/`correctAnswer`
      intentionally retained).
- [ ] `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` green across protocol, game-sdk,
      game-engine, web, and both game packages.
- [ ] Trivia and Liar Liar e2e specs pass unchanged in behavior.
- [ ] `PROTOCOL_VERSION` bumped.
