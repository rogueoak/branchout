# 0010 - Web game client for Trivia

## Problem

Trivia has engine logic (`0008`) and a control-plane to host it (`0006`), but no screen a player
touches. Branch out needs the browser client: a lobby to make or join a room, the interactive and
remote layouts, and the in-game flow from prompt to stars. This is where a player actually plays.

Depends on `0006` (rooms, modes, start rule, credit gating), `0007` (the WebSocket protocol and
lifecycle), and `0008` (the Trivia rules it renders). It is the last spec of the first vertical
slice - the front end that closes the loop.

## Outcome

- A player can create a room or join by code, pick interactive or remote, and see a host config
  panel for Trivia.
- The host can start only once a viewer is present and the rounds are affordable.
- In game, players see the prompt, answer, watch reveal and scoring, dispute and vote, read the
  between-round leaderboard, and reach a final results screen with stars - all streamed over the
  engine WebSocket.

## Scope

In (in `apps/web`, the game client):
- **Lobby** - create a room or join by code; each player picks **interactive** or **remote**; a
  **host config panel** for Trivia: category (the 8 plus **Random**), rounds (1 to 100, default
  10), difficulty (1 to 10, default 5). A **Start** button, shown only to the host, disabled until
  at least one viewer is present and the host can afford the requested rounds. Show why start is
  disabled.
- **Interactive layout** - **viewer on the left, remote on the right**; stacked on small screens.
  An **observer** sees the viewer only.
- **In-game**:
  - **Prompt** on the viewer.
  - **Free-text answer input** on the remote (and on the interactive player's remote pane).
  - **Reveal + scoring** after the round closes.
  - A **dispute** button available during the **10s** dispute window, and a **vote UI** shown to
    the other players when a dispute is raised.
  - A between-round **leaderboard**.
  - The host's **advance** control to move to the next round.
  - A **final results screen** with the standings and **stars**.
- Connects to the engine over **WebSocket using `packages/protocol`** types (`0007`); built on
  **canopy**, the **Confetti theme** (`0002`), and the **brand assets** (`0003`). Light and dark,
  responsive, accessible.

Out:
- Game logic - draw, matching, dispute resolution, scoring (that is `0008`, on the engine).
- Rooms, credits, and stars math (`0006`). The protocol itself (`0007`). Non-Trivia games. Full
  profile pages and friend search (later web specs). The marketing landing page (`0005`).

## Approach

- **One client, protocol-typed** - all engine traffic goes through the `0007` `packages/protocol`
  types, so a message the UI does not handle is a type error, not a blank screen. The client is a
  view over engine state: it renders the phase the engine reports and sends join/answer/vote/
  dispute/advance messages back.
- **Layout from mode** - interactive renders viewer and remote panes side by side (stacked on
  narrow screens); remote renders the remote pane only; observer renders the viewer only. One
  layout component keyed by mode and role, no forked screens.
- **Host affordability in the UI** - the Start button mirrors `0006`'s rule: it reads viewer
  presence and the host's balance versus the requested rounds and stays disabled with a plain
  reason until both pass. The server re-checks on start; the UI gate is a courtesy, not the
  authority.
- **Dispute + vote timing** - the client shows the dispute button for the engine-driven 10s
  window and renders the vote UI to the other players when the engine signals a dispute; it never
  runs the timer or tallies votes itself - it reflects engine state.
- **Theme and assets** - compose from canopy components on the Confetti theme with the brand
  assets; no one-off styling or hardcoded colors, so it re-themes in light and dark for free.

## Acceptance

- [ ] A player can create a room or join by code and pick interactive or remote; the host sees a
      Trivia config panel with category (8 + Random), rounds (1-100 default 10), and difficulty
      (1-10 default 5).
- [ ] The Start button shows only to the host and is disabled, with a stated reason, until a
      viewer is present and the rounds are affordable.
- [ ] Interactive shows viewer left and remote right, stacked on small screens; an observer sees
      the viewer only; remote shows the remote pane only.
- [ ] In game the viewer shows the prompt, the remote takes a free-text answer, and reveal +
      scoring render after the round closes.
- [ ] A dispute button is available during the 10s window and a vote UI shows to the other
      players when a dispute is raised; the client reflects engine state and does not run the
      timer or tally.
- [ ] A leaderboard shows between rounds, the host advances, and a final results screen shows
      standings with stars.
- [ ] All engine traffic uses `packages/protocol` types; the UI is built on canopy + the Confetti
      theme + brand assets and passes light/dark, responsive, and basic a11y checks.
