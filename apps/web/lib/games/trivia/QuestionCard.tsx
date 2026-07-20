'use client';

// The in-round question screen (spec 0069, WS4): the question in a canopy Card with the round +
// difficulty badges on top, a big central countdown whose colour escalates as a percentage of the
// configured time limit, and a live "x of y answered" line. Rendered by the shared viewer, and by a
// remote-only controller which has no viewer beside it. It reads engine state; it never runs the
// clock (the countdown anchors the engine's authoritative remaining-ms via `useMoveCountdown`).

import { Badge } from '@rogueoak/canopy';
import { Card, CardContent, CardHeader } from '@rogueoak/canopy/twigs';
import type { GameState } from '../../game-state';
import type { TriviaPrompt } from './protocol';
import { difficultyBand } from './config';
import { countdownTone } from './countdown';
import { useMoveCountdown } from '../../use-move-countdown';
import { usePrefersReducedMotion } from '../../use-prefers-reduced-motion';

const TONE_CLASS: Record<string, string> = {
  neutral: 'text-text',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function TriviaQuestionCard({ state, prompt }: { state: GameState; prompt: TriviaPrompt }) {
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);
  const reducedMotion = usePrefersReducedMotion();

  const connected = state.players.filter((player) => player.connected).length;

  // The countdown block: a big central number, coloured by how much of the window is left, blinking
  // only in the danger zone and only when motion is allowed.
  let countdown = null;
  if (secondsLeft !== null) {
    const tone = state.paused ? 'neutral' : countdownTone(secondsLeft, state.moveWindowMs);
    const blink = tone === 'danger' && !state.paused && !reducedMotion;
    const blinkClass = blink ? 'animate-pulse' : '';
    const label = state.paused ? 'Paused' : `${secondsLeft} seconds left to answer`;
    countdown = (
      <div className="flex flex-col items-center gap-1 py-2">
        <span
          role="timer"
          aria-label={label}
          className={`text-display font-semibold tabular-nums ${TONE_CLASS[tone]} ${blinkClass}`}
        >
          {state.paused ? 'Paused' : secondsLeft}
        </span>
        {state.paused ? null : (
          <span className="text-caption uppercase tracking-wide text-text-subtle">
            seconds left
          </span>
        )}
      </div>
    );
  }

  // "x of y players answered" - the live count, shown once the engine reports it (absent on a peer
  // predating the field). Solo games still read sensibly ("0 of 1 answered").
  let answered = null;
  if (state.answered !== null) {
    answered = (
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        {state.answered} of {connected} {connected === 1 ? 'player' : 'players'} answered
      </p>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 pb-2">
        <Badge variant="info">Round {prompt.round}</Badge>
        <Badge variant="neutral">{prompt.category}</Badge>
        <Badge variant="neutral">{difficultyBand(prompt.difficulty)}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-h2 text-text" data-testid="question-prompt">
          {prompt.question}
        </h2>
        {countdown}
        {answered}
      </CardContent>
    </Card>
  );
}
