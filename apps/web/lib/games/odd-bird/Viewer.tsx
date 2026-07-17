'use client';

// Odd Bird's viewer: the shared screen everyone watches. It NEVER shows a secret (the roost, a perch,
// or who the odd bird is) - each player reads their own card on their phone (the Remote, via
// `state.private`). The viewer renders the public framing while the flock questions each other, the
// flush prompt while everyone votes, and the round result (the roost, who the odd bird was, how the
// flush landed) between rounds - then the standings and final results. It reads state; it never drives
// the game. The opaque prompt/reveals are decoded here at the render boundary (spec 0023).

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { useMoveCountdown } from '../../use-move-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asOddBirdPrompt, pickResult } from './protocol';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function OddBirdViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const prompt = asOddBirdPrompt(state.prompt);
  const result = pickResult(state.reveals);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);

  if (phase === 'complete') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {result ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4">
            <Badge variant={result.flockWon ? 'success' : 'danger'} className="w-fit">
              {result.flockWon ? 'The flock wins' : 'The odd bird wins'}
            </Badge>
            <p className="text-body-sm text-text-muted">The roost was</p>
            <p className="text-h3 text-success">{result.roost}</p>
            <p className="text-body text-text">
              The odd bird was{' '}
              <span className="font-medium text-secondary">
                {nicknameOf(players, result.oddBird)}
              </span>
              .
            </p>
            <p className="text-body-sm text-text-muted">
              {result.flushed
                ? `The flock flushed ${nicknameOf(players, result.flushed)}.`
                : 'The flock could not agree, so no one was flushed.'}
            </p>
            {result.guessedRoost ? (
              <p className="text-body-sm text-text">
                The odd bird named the roost{result.guessedName ? ` (${result.guessedName})` : ''}.
              </p>
            ) : null}
          </div>
        ) : null}
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (phase === 'leaderboard') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        {result ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4">
            <Badge variant={result.flockWon ? 'success' : 'danger'} className="w-fit">
              {result.flockWon ? 'The flock wins' : 'The odd bird wins'}
            </Badge>
            <p className="text-h3 text-success">{result.roost}</p>
            <p className="text-body text-text">
              The odd bird was{' '}
              <span className="font-medium text-secondary">
                {nicknameOf(players, result.oddBird)}
              </span>
              .
            </p>
          </div>
        ) : null}
        <Leaderboard standings={standings} me={me} />
      </section>
    );
  }

  if (prompt && phase === 'guessing') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <Badge variant="warning" className="w-fit">
          The flush
        </Badge>
        <h2 className="text-h2 text-text">Who is the odd bird?</h2>
        <p className="text-body text-text-muted">
          Everyone votes on their phone. The flock accuses a player; the odd bird tries to name the
          roost.
        </p>
      </section>
    );
  }

  if (prompt && phase === 'collecting') {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{prompt.players} at the roost</Badge>
          <Badge variant="neutral">{label(prompt.category)}</Badge>
          {secondsLeft !== null ? (
            <Badge variant={secondsLeft <= 30 ? 'warning' : 'neutral'}>
              <span role="timer" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}s left
              </span>
            </Badge>
          ) : null}
        </div>
        <h2 className="text-h2 text-text">Question the flock</h2>
        <p className="text-body text-text-muted">
          Check your own card on your phone, then ask each other pointed questions out loud. One of
          you is the odd bird and does not know the roost. Call the flush when you are ready to
          vote.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-2">
      <h2 className="text-h3 text-text">Get ready</h2>
      <p className="text-body text-text-muted">Dealing the roost and the perches...</p>
    </section>
  );
}
