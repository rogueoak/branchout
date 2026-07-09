'use client';

// Liar Liar's viewer: the shared screen everyone watches. It renders the clue while players write
// their lies, the shuffled options while everyone guesses, and the round result (the truth, who wrote
// each lie, who it fooled, who guessed right) between rounds - then the standings and final results.
// It reads state; it never drives the game. The opaque prompt/reveals are decoded here at the render
// boundary (spec 0023).

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useAnswerCountdown } from '../../use-answer-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLiarLiarPrompt, pickOptions, pickResult } from './protocol';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function LiarLiarViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asLiarLiarPrompt(state.prompt);
  const options = pickOptions(state.reveals);
  const result = pickResult(state.reveals);
  const secondsLeft = useAnswerCountdown(state.answerMsRemaining, state.round, state.paused);

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {result ? (
          <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
            <Badge variant="primary" className="w-fit">
              Round {result.round} - the truth
            </Badge>
            <p className="text-body-sm text-text-muted">{result.clue}</p>
            <p className="text-h3 text-success">{result.truth}</p>
            <ul aria-label="Round result" className="flex flex-col gap-2">
              {result.options.map((option) => (
                <li key={option.id} className="flex flex-col gap-0.5">
                  <span
                    className={`break-words text-body ${
                      option.kind === 'truth' ? 'font-medium text-success' : 'text-text'
                    }`}
                  >
                    {option.text}
                    {option.kind === 'truth' ? ' (the truth)' : ''}
                  </span>
                  <span className="text-caption text-text-subtle">
                    {option.kind === 'fake' && option.author === me ? (
                      <strong className="text-secondary">Your lie</strong>
                    ) : option.kind === 'fake' && option.author ? (
                      `Lie by ${nicknameOf(players, option.author)}`
                    ) : (
                      'The real answer'
                    )}
                    {option.kind === 'fake' && option.pickedBy.length > 0
                      ? ` - fooled ${option.pickedBy.map((id) => nicknameOf(players, id)).join(', ')}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-body-sm text-text">
              {result.correctGuessers.length === 0
                ? 'Nobody found the truth!'
                : `Guessed the truth: ${result.correctGuessers
                    .map((id) => nicknameOf(players, id))
                    .join(', ')}`}
            </p>
          </div>
        ) : null}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (prompt && phase === 'guessing') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          <Badge variant="neutral">{label(prompt.category)}</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 10 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">{prompt.clue}</h2>
        <p className="text-body text-text-muted">
          Which one is the truth? Pick the real answer on your phone.
        </p>
        <ol aria-label="Answers to guess" className="flex flex-col gap-2">
          {(options?.options ?? []).map((option, index) => (
            <li
              key={option.id}
              className="flex items-baseline gap-3 rounded-md bg-surface-raised px-3 py-2"
            >
              <span className="tabular-nums text-text-subtle">{index + 1}</span>
              <span className="break-words text-body text-text">{option.text}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (prompt && phase === 'collecting') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          <Badge variant="neutral">{label(prompt.category)}</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 15 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">{prompt.clue}</h2>
        <p className="text-body text-text-muted">
          Everyone is writing a convincing lie. Fool your friends!
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first clue is on its way.</p>
    </section>
  );
}
