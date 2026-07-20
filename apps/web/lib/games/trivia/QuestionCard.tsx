'use client';

// The in-round question screen (spec 0069, WS4/WS16): the question in a canopy Card with the round +
// difficulty badges on top, then a SMALL separate countdown Card just below it whose number is a step
// under the question size and whose colour escalates as a percentage of the configured time limit, and
// a live "x of y answered" line. Rendered by the shared viewer, and by a remote-only controller which
// has no viewer beside it. It reads engine state; it never runs the clock (the countdown anchors the
// engine's authoritative remaining-ms via `useMoveCountdown`).

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

  // The countdown block: its own small Card just under the question, a central number sized a step
  // BELOW the question (text-h3 vs the question's text-h2) so it reads as a timer, not a headline. Its
  // colour escalates with how much of the window is left; in the danger zone it blinks with a fast
  // custom pulse (animate-countdown-blink, ~0.5s - quicker than animate-pulse), but only when motion is
  // allowed (prefers-reduced-motion drops the blink entirely).
  let countdown = null;
  if (secondsLeft !== null) {
    const tone = state.paused ? 'neutral' : countdownTone(secondsLeft, state.moveWindowMs);
    const blink = tone === 'danger' && !state.paused && !reducedMotion;
    const blinkClass = blink ? 'animate-countdown-blink' : '';
    const label = state.paused ? 'Paused' : `${secondsLeft} seconds left to answer`;
    countdown = (
      <Card className="w-full" data-testid="countdown-card">
        <CardContent className="flex flex-col items-center gap-0.5 py-3">
          <span
            role="timer"
            aria-label={label}
            className={`text-h3 font-semibold tabular-nums ${TONE_CLASS[tone]} ${blinkClass}`}
          >
            {state.paused ? 'Paused' : secondsLeft}
          </span>
          {state.paused ? null : (
            <span className="text-caption uppercase tracking-wide text-text-subtle">
              seconds left
            </span>
          )}
        </CardContent>
      </Card>
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

  // Layout: the question Card, then the small countdown Card beneath it (same position the countdown
  // held before - directly under the question), then the live answered count.
  return (
    <div className="flex w-full flex-col gap-3">
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
        </CardContent>
      </Card>
      {countdown}
      {answered}
    </div>
  );
}
