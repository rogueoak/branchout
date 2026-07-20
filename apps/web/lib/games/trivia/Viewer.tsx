'use client';

// The viewer: the shared screen everyone watches. It renders the current phase of engine state -
// the in-round question card while answering (spec 0069), the answer reveal once the round closes,
// the between-round leaderboard, and the final results. It reads state; it never drives the game.

import type { GameState } from '../../game-state';
import { asTriviaPrompt, pickTriviaRoundReveal, pickTriviaDisputeReveal } from './protocol';
import { useDwellCountdown } from '../../use-dwell-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { TriviaQuestionCard } from './QuestionCard';
import { AnswerReveal } from './AnswerReveal';

interface ViewerPaneProps {
  state: GameState;
  me?: string;
}

export function ViewerPane({ state, me }: ViewerPaneProps) {
  const { phase, standings, players } = state;
  // Decode the opaque prompt/reveals into Trivia shapes at the render boundary (spec 0023): the
  // reducer stores them raw; a shape this game does not recognize is a null, a skipped render.
  const prompt = asTriviaPrompt(state.prompt);
  const reveal = pickTriviaRoundReveal(state.reveals);
  const disputeResult = pickTriviaDisputeReveal(state.reveals);
  // The auto-advance dwell countdown ("continuing in x" / "next round in x"), driven by the engine's
  // authoritative remaining-ms; null when auto-advance is off (no dwell window is armed).
  const dwellSecondsLeft = useDwellCountdown(state.autoAdvanceMsRemaining, phase, state.paused);

  let body = null;
  if (phase === 'complete') {
    body = <FinalResults standings={standings} me={me} />;
  } else if (phase === 'leaderboard') {
    // With auto-advance on, the Leaderboard's own "next round in x" carries the message; only when
    // the host advances by hand (no dwell) do we tell watchers they are waiting on the host.
    const waitingNote =
      dwellSecondsLeft === null ? (
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      ) : null;
    body = (
      <div className="flex flex-col gap-3">
        <Leaderboard standings={standings} me={me} autoAdvanceSecondsLeft={dwellSecondsLeft} />
        {waitingNote}
      </div>
    );
  } else if (phase === 'collecting' && prompt) {
    body = <TriviaQuestionCard state={state} prompt={prompt} />;
  } else if (reveal) {
    body = (
      <AnswerReveal
        reveal={reveal}
        players={players}
        phase={phase}
        disputeResult={disputeResult}
        dwellSecondsLeft={dwellSecondsLeft}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">Get ready</h2>
        <p className="text-body text-text-muted">The first question is on its way.</p>
      </div>
    );
  }

  // The paused banner lives once at the GameStage level (host-aware), so the viewer pane does not
  // carry its own.
  return (
    <section aria-label="Game viewer" className="flex flex-col gap-5">
      {body}
    </section>
  );
}
