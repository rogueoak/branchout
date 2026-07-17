'use client';

// Sketchy's viewer: the shared screen everyone watches (spec 0063). It renders the "everyone is
// drawing" cue during a draw round, the gallery of sketches between rounds, the featured sketch +
// shuffled options while everyone guesses, and the round result (the true seed, who wrote each decoy,
// who it fooled, who guessed right) - then the standings and final results. It reads state; it never
// drives the game. The opaque prompt/reveals are decoded at the render boundary. A player's own seed
// is NEVER on the shared screen (it lives only in that player's private payload).

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asSketchyPrompt, pickGallery, pickOptions, pickResult } from './protocol';
import { SketchReplay } from './SketchReplay';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function SketchyViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asSketchyPrompt(state.prompt);
  const options = pickOptions(state.reveals);
  const result = pickResult(state.reveals);
  const gallery = pickGallery(state.reveals);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);

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
              Round {result.round} - the true seed
            </Badge>
            {result.sketch ? (
              <div className="mx-auto w-full max-w-xs">
                <SketchReplay
                  sketch={result.sketch}
                  label={`Sketch by ${result.featured ? nicknameOf(players, result.featured) : 'a player'}`}
                />
              </div>
            ) : null}
            <p className="text-h3 text-success">{result.trueSeed}</p>
            <ul aria-label="Round result" className="flex flex-col gap-2">
              {result.options.map((option) => (
                <li key={option.id} className="flex flex-col gap-0.5">
                  <span
                    className={`break-words text-body ${
                      option.kind === 'truth' ? 'font-medium text-success' : 'text-text'
                    }`}
                  >
                    {option.text}
                    {option.kind === 'truth' ? ' (the true seed)' : ''}
                  </span>
                  <span className="text-caption text-text-subtle">
                    {option.kind === 'decoy' && option.author === me ? (
                      <strong className="text-secondary">Your decoy</strong>
                    ) : option.kind === 'decoy' && option.author ? (
                      `Decoy by ${nicknameOf(players, option.author)}`
                    ) : (
                      'The real seed'
                    )}
                    {option.kind === 'decoy' && option.pickedBy.length > 0
                      ? ` - fooled ${option.pickedBy.map((id) => nicknameOf(players, id)).join(', ')}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-body-sm text-text">
              {result.correctGuessers.length === 0
                ? 'Nobody found the true seed!'
                : `Found the true seed: ${result.correctGuessers
                    .map((id) => nicknameOf(players, id))
                    .join(', ')}`}
            </p>
          </div>
        ) : gallery ? (
          <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
            <Badge variant="primary" className="w-fit">
              Round {gallery.round} - the sketches
            </Badge>
            <ul aria-label="The sketches" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {gallery.gallery.map((entry) => (
                <li key={entry.player} className="flex flex-col gap-1">
                  {entry.sketch ? (
                    <SketchReplay
                      sketch={entry.sketch}
                      label={`Sketch by ${nicknameOf(players, entry.player)}`}
                    />
                  ) : null}
                  <span className="text-caption text-text-subtle">
                    {nicknameOf(players, entry.player)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (phase === 'guessing' && options) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {options.round}</Badge>
          {options.featured ? (
            <Badge variant="neutral">{nicknameOf(players, options.featured)}&apos;s sketch</Badge>
          ) : null}
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 10 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        {options.sketch ? (
          <div className="mx-auto w-full max-w-sm">
            <SketchReplay sketch={options.sketch} label="The sketch to guess" />
          </div>
        ) : null}
        <p className="text-body text-text-muted">
          Which one is the true seed? Pick the real prompt on your phone.
        </p>
        <ol aria-label="Seeds to guess" className="flex flex-col gap-2">
          {options.options.map((option, index) => (
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

  if (phase === 'collecting' && prompt?.stage === 'sketch') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          {prompt.featured ? (
            <Badge variant="neutral">{nicknameOf(players, prompt.featured)}&apos;s sketch</Badge>
          ) : null}
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 10 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        {prompt.sketch ? (
          <div className="mx-auto w-full max-w-sm">
            <SketchReplay sketch={prompt.sketch} label="The featured sketch" />
          </div>
        ) : null}
        <p className="text-body text-text-muted">
          Everyone is writing a fake seed for this sketch. Fool your friends!
        </p>
      </section>
    );
  }

  if (phase === 'collecting' && prompt?.stage === 'draw') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {prompt.round}</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 15 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">Everyone is drawing their secret seed</h2>
        <p className="text-body text-text-muted">
          Each player has a different prompt only they can see. Draw it on your phone!
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first seeds are on their way.</p>
    </section>
  );
}
