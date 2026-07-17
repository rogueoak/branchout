'use client';

// Lone Leaf's viewer: the shared screen everyone watches. It never shows the SEED while the round is
// live (the seed is a per-player secret the Seeker must not see, delivered via the Remote's private
// channel), so the viewer is safe to broadcast to every device including the Seeker's. It renders who
// the Seeker is + the theme while leaves are written, the surviving leaves while the Seeker guesses,
// and the result (the seed, the guess, whether the grove banked it) between rounds. It reads state; it
// never drives the game. Opaque prompt/reveals are decoded at the render boundary (spec 0023).

import type { ReactNode } from 'react';
import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLoneLeafPrompt, pickResult, pickSurvivors } from './protocol';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** The countdown badge, or null once the timer has stopped. Warns under `warnAt` seconds. */
function timerBadge(secondsLeft: number | null, warnAt: number): ReactNode {
  if (secondsLeft === null) return null;
  const variant = secondsLeft <= warnAt ? 'warning' : 'neutral';
  return (
    <Badge variant={variant}>
      <span role="timer" aria-label={`${secondsLeft} seconds left`}>
        {secondsLeft}s left
      </span>
    </Badge>
  );
}

export function LoneLeafViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asLoneLeafPrompt(state.prompt);
  const survivors = pickSurvivors(state.reveals);
  const result = pickResult(state.reveals);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    let resultBlock: ReactNode = null;
    if (result) {
      const outcomeVariant = result.correct ? 'success' : 'warning';
      const outcomeLabel = result.correct ? 'the grove banked it' : 'the leaf got away';
      const guessTone = result.correct ? 'text-success' : 'text-danger';
      resultBlock = (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
          <Badge variant={outcomeVariant} className="w-fit">
            Round {result.round} - {outcomeLabel}
          </Badge>
          <p className="text-body-sm text-text-muted">The seed was</p>
          <p className="text-h3 text-success">{result.seed}</p>
          <p className="text-body text-text">
            {nicknameOf(players, result.seeker)} guessed{' '}
            <strong className={guessTone}>{result.guess || '(nothing)'}</strong>.
          </p>
          <ul aria-label="Round leaves" className="flex flex-col gap-1">
            {result.leaves.map((leaf) => {
              const wordTone = leaf.survived ? 'text-text' : 'text-text-subtle line-through';
              const wiltedTag = leaf.survived ? '' : ' - wilted';
              return (
                <li key={leaf.player} className="flex items-baseline gap-2">
                  <span className={`break-words text-body ${wordTone}`}>{leaf.word}</span>
                  <span className="text-caption text-text-subtle">
                    {nicknameOf(players, leaf.player)}
                    {wiltedTag}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {resultBlock}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (prompt && phase === 'guessing') {
    const seekerName = nicknameOf(players, prompt.seeker);
    const iAmSeeker = me === prompt.seeker;
    const survivorWords = survivors?.survivors ?? [];
    const heading = iAmSeeker
      ? 'Your surviving leaves'
      : `${seekerName} is guessing from these leaves`;
    const guessHint = iAmSeeker
      ? 'Type your one guess on your phone.'
      : 'Matching leaves wilted away. Only the unique ones survived.';
    const leafList =
      survivorWords.length === 0 ? (
        <p className="text-body text-text-muted">
          Every leaf wilted - the Seeker has nothing to go on this round.
        </p>
      ) : (
        <ul aria-label="Surviving leaves" className="flex flex-wrap gap-2">
          {survivorWords.map((word, index) => (
            <li
              key={`${word}-${index}`}
              className="rounded-md bg-surface-raised px-3 py-2 text-body text-text"
            >
              {word}
            </li>
          ))}
        </ul>
      );
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          <Badge variant="neutral">{label(prompt.category)}</Badge>
          {timerBadge(secondsLeft, 10)}
        </div>
        <h2 className="text-h2 text-text">{heading}</h2>
        {leafList}
        <p className="text-body text-text-muted">{guessHint}</p>
      </section>
    );
  }

  if (prompt && phase === 'collecting') {
    const seekerName = nicknameOf(players, prompt.seeker);
    const iAmSeeker = me === prompt.seeker;
    const heading = iAmSeeker ? 'You are the Seeker' : `${seekerName} is the Seeker`;
    const intro = iAmSeeker
      ? 'You cannot see the seed. Everyone else is writing one-word leaves to help you guess it.'
      : 'Write one word to help the Seeker - but matching words wilt, so think alike, not too alike.';
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          <Badge variant="neutral">{label(prompt.category)}</Badge>
          {timerBadge(secondsLeft, 15)}
        </div>
        <h2 className="text-h2 text-text">{heading}</h2>
        <p className="text-body text-text-muted">{intro}</p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first seed is on its way.</p>
    </section>
  );
}
