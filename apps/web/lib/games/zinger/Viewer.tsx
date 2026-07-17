'use client';

// Zinger's viewer: the shared screen everyone watches. It renders the setup while players write their
// zingers, the two zingers of the face-off while everyone votes, and the round result (the winner,
// each zinger's author + vote tally, a clean-sweep flag) between rounds - then the standings and final
// results. It reads state; it never drives the game. The opaque prompt/reveals are decoded here at the
// render boundary (spec 0053).

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asZingerPrompt, pickFaceOff, pickResult } from './protocol';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function ZingerViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asZingerPrompt(state.prompt);
  const faceOff = pickFaceOff(state.reveals);
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
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {result ? (
          <div className="flex flex-col gap-3 rounded-lg bg-surface-raised p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary" className="w-fit">
                Round {result.round} - the face-off
              </Badge>
              {result.cleanSweep ? (
                <Badge variant="success" className="w-fit">
                  Clean sweep!
                </Badge>
              ) : null}
            </div>
            <p className="text-body-sm text-text-muted">{result.setup}</p>
            <ul aria-label="Face-off result" className="flex flex-col gap-2">
              {result.options.map((option) => (
                <li key={option.id} className="flex flex-col gap-0.5">
                  <span
                    className={`break-words text-body ${
                      option.winner ? 'font-medium text-success' : 'text-text'
                    }`}
                  >
                    {option.text}
                    {option.winner ? ' (winner)' : ''}
                  </span>
                  <span className="text-caption text-text-subtle">
                    {option.author === me ? (
                      <strong className="text-secondary">Your zinger</strong>
                    ) : option.author ? (
                      `by ${nicknameOf(players, option.author)}`
                    ) : (
                      'A zinger'
                    )}
                    {` - ${option.votes} ${option.votes === 1 ? 'vote' : 'votes'}`}
                  </span>
                </li>
              ))}
            </ul>
            {result.winner === null ? (
              <p className="text-body-sm text-text">A tie - no points this round.</p>
            ) : null}
          </div>
        ) : null}
        <Leaderboard standings={standings} me={me} />
        <p className="text-body-sm text-text-muted">
          Waiting for the host to start the next round.
        </p>
      </section>
    );
  }

  if (faceOff && phase === 'guessing') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Round {faceOff.round}</Badge>
          <Badge variant="neutral">The face-off</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 10 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">{faceOff.setup}</h2>
        <p className="text-body text-text-muted">
          Which zinger landed hardest? Vote on your phone.
        </p>
        <ol aria-label="Zingers to vote on" className="flex flex-col gap-2">
          {faceOff.options.map((option, index) => (
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
          <Badge variant="neutral">The setup</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 15 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">{prompt.setup}</h2>
        <p className="text-body text-text-muted">Everyone is writing a zinger. Make it land!</p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">The first setup is on its way.</p>
    </section>
  );
}
