# 0023 - Game-pluggable web client + Liar Liar UI + game selection

## Problem

The browser game client is hardwired to Trivia: `GameState.prompt/reveal` are Trivia types, the
decoders in `lib/game-protocol.ts` are Trivia-specific, `ViewerPane`/`RemotePane` render Trivia
screens by phase, and the room selects `'trivia'` by a hardcoded id with a Trivia-only config panel.
Now that the engine registers a second game (Liar Liar, specs 0020-0022), the client needs to render
it too - and, mirroring the engine's plugin architecture, it should do so through a **per-game UI
registry** rather than more `if (game === ...)` branching. The control-plane already passes the game
id + opaque config through unchanged, so this is almost entirely a web change.

## Outcome

- The web client is game-agnostic at its core: `GameState` carries the opaque `prompt`/`reveal`
  payloads raw, plus a new `rejected` field for the `answer_rejected` frame; the generic layout
  (`GameStage`) and the shared lobby/leaderboard/final-results stay, but the per-game *content*
  (config panel, viewer screens, remote screens, payload decoders) comes from a UI module keyed by
  game id.
- Trivia's UI is refactored into a `trivia` module (behavior unchanged). A new `liar-liar` module
  renders the bluffing game: a clue on the viewer, a "write your lie" remote (with the vague
  "someone already submitted that" rejection inline), a reveal of all options, a "pick the truth"
  guess remote, and a round result showing the truth and who fooled whom.
- The host picks the game in the lobby (Trivia or Liar Liar); the chosen module's config panel and id
  drive `selectGame`/`startGame`. Mobile-first at ~360px, fun/quirky, on canopy + Confetti.

## Scope

In:
- **`apps/web/lib/games/registry.ts`**: a `GameUiModule` interface (`id`, `name`, `ConfigPanel`,
  `defaultConfig`, `validateConfig`, `Viewer`, `Remote`) and a registry `getGameUi(id)`.
- **Make the client game-agnostic**: `GameState.prompt/reveal/disputeResult -> raw unknown`; add
  `rejected: string | null`; `reduceGameState` stores raw payloads, handles the `answer_rejected`
  frame (set `rejected`, cleared on the next `prompt`/successful action) and the `guessing` phase;
  `GameClient`/`useGameClient` expose generic `submitAnswer` + `submitVote(round, target, agree)`
  (Trivia's dispute/ballot and Liar Liar's guess are both `submitVote`).
- **`apps/web/lib/games/trivia/`**: move the Trivia decoders (from `game-protocol.ts`), config
  (`trivia-config.ts`), the host config form, and the Trivia viewer/remote rendering into a module;
  register it. No behavior change to the Trivia experience.
- **`apps/web/lib/games/liar-liar/`**: `protocol.ts` (decode the clue prompt and the two reveal
  shapes - the guess options and the final attributed result), `config.ts` (1-3 categories or random
  + rounds), `ConfigPanel.tsx`, `Viewer.tsx` (collecting -> guessing/options -> result -> standings),
  `Remote.tsx` (write-a-lie with inline rejection -> pick-the-truth -> waiting states). Register it.
- **`GameStage`/`ViewerPane`/`RemotePane`** become generic shells delegating content to the selected
  module; the shared `Leaderboard`/`FinalResults` stay reusable.
- **Lobby game selection**: a game picker (Trivia/Liar Liar), dispatching to the module's config
  panel; `RoomClient` passes the chosen game id (no more hardcoded `'trivia'`).
- **Tests**: reducer tests for raw payloads + the reject frame + the `guessing` phase; component
  tests for the Liar Liar viewer/remote across phases (write-a-lie, rejection, guess, result) and the
  game picker; existing Trivia component/reducer tests keep passing (moved, not rewritten).

Out:
- Any control-plane change (its game selection is already a generic opaque passthrough). The clue
  content (0022). LAN dev / connect-URL (0024). A full multi-device Playwright browser e2e is
  out unless trivially addable - the coverage here is component + reducer tests (the app's
  established style); a browser e2e can follow.

## Approach

- **Mirror the engine's plugin split on the client.** The registry is the one place a game's UI
  attaches, exactly as `registerPlugins` is on the engine. Adding a game is adding a UI module +
  registering it - no core/shell edits.
- **Raw payloads, decode at the edge.** The reducer stops knowing Trivia shapes; each module decodes
  its own `prompt`/`reveal` at render time (the decoders move with the module). This is the same
  "opaque payload, game owns the shape" contract the engine already uses.
- **`answer_rejected` is a client state, not a screen.** The reducer records the reason; the Liar
  Liar remote shows it inline next to the lie input and lets the player retype. Cleared on the next
  prompt or a successful submit.
- **Keep the generic shell honest.** `GameStage`'s mode/role/host-controls layout and the shared
  standings components are game-agnostic and stay; only the per-phase content is delegated.

## Acceptance

- [ ] A `GameUiModule` registry keyed by game id; Trivia and Liar Liar are both modules; the shell
      renders the module by the room's selected game with no game-specific branching in core.
- [ ] Trivia plays exactly as before (its moved tests pass unchanged).
- [ ] Liar Liar plays in the browser: host configures categories+rounds and starts; the viewer shows
      the clue then the options; a remote writes a lie, sees the vague rejection on a duplicate/the
      truth and can retype, then picks the truth; the result shows the truth and who fooled whom;
      standings and play-again/exit via host controls.
- [ ] The host picks the game in the lobby; the right config panel shows; `selectGame` sends the
      chosen id + config.
- [ ] Mobile-first at ~360px; canopy + Confetti; a11y. `pnpm build && typecheck && test && lint &&
      format:check` green.
