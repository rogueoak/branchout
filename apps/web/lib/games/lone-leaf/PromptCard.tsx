'use client';

// Lone Leaf's in-round prompt card (WS17, matching Trivia's WS16 treatment): the round's heading + its
// body sit in a canopy Card with the round + theme badges on top, then a SMALL separate countdown Card
// just below it whose number is a step under the heading size (text-h3 vs the heading's text-h2) so it
// reads as a timer, not a headline. It is a THIN wrapper - it reuses Trivia's countdown colour rule
// (`countdownTone`) and the shared `useMoveCountdown` hook rather than re-implementing them, and it
// never runs the clock (the countdown anchors the engine's authoritative remaining-ms). Rendered by the
// viewer, and by a remote-only controller which has no viewer pane beside it.

import type { ReactNode } from 'react';
import { Badge } from '@rogueoak/canopy';
import { Card, CardContent, CardHeader } from '@rogueoak/canopy/twigs';
import type { GameState } from '../../game-state';
import { countdownTone } from '../trivia/countdown';
import { useMoveCountdown } from '../../use-move-countdown';
import { usePrefersReducedMotion } from '../../use-prefers-reduced-motion';

const TONE_CLASS: Record<string, string> = {
  neutral: 'text-text',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Title-case a theme slug for display ("food" -> "Food"). */
function themeLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function LoneLeafPromptCard({
  state,
  round,
  category,
  heading,
  children,
}: {
  state: GameState;
  round: number;
  category: string;
  heading: string;
  children?: ReactNode;
}) {
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);
  const reducedMotion = usePrefersReducedMotion();

  // The countdown block: its own small Card just under the prompt, a central number sized a step BELOW
  // the heading (text-h3 vs the heading's text-h2) so it reads as a timer, not a headline. Its colour
  // escalates with how much of the window is left; in the danger zone it blinks with the fast custom
  // pulse (animate-countdown-blink, ~0.5s), but only when motion is allowed (prefers-reduced-motion
  // drops the blink entirely). Warning state does not blink. Same treatment Trivia uses.
  let countdown = null;
  if (secondsLeft !== null) {
    const tone = state.paused ? 'neutral' : countdownTone(secondsLeft, state.moveWindowMs);
    const blink = tone === 'danger' && !state.paused && !reducedMotion;
    const blinkClass = blink ? 'animate-countdown-blink' : '';
    const timerLabel = state.paused ? 'Paused' : `${secondsLeft} seconds left`;
    countdown = (
      <Card className="w-full" data-testid="countdown-card">
        <CardContent className="flex flex-col items-center gap-0.5 py-3">
          <span
            role="timer"
            aria-label={timerLabel}
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

  // Layout: the prompt Card, then the small countdown Card beneath it (directly under the prompt).
  return (
    <div className="flex w-full flex-col gap-3">
      <Card className="w-full">
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 pb-2">
          <Badge variant="info">Round {round}</Badge>
          <Badge variant="neutral">{themeLabel(category)}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-h2 text-text" data-testid="lone-leaf-prompt">
            {heading}
          </h2>
          {children}
        </CardContent>
      </Card>
      {countdown}
    </div>
  );
}
