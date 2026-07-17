'use client';

// Odd Bird's remote: the private controller each player acts on. It is the ONLY place this player's
// secret card is shown - the roost + their perch, or "you are the odd bird" - read from `state.private`
// (spec 0052), which the engine delivered only to this device. While the flock questions each other
// out loud, the remote shows the card and a "Call the flush" button. When the flush opens, a flock
// member accuses who they think is the odd bird; the odd bird instead guesses the roost. It never runs
// a timer or tallies - it sends frames and reflects the phase the engine reports.

import { Badge, Button } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { PlayerView } from '@branchout/protocol';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asOddBirdCard, pickFlush } from './protocol';
import { ROOST_GUESS_TARGET_PREFIX } from './index';

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function OddBirdRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
  onVote,
}: GameRemoteProps) {
  const { phase, round, players } = state;
  const card = asOddBirdCard(state.private);
  const [flushCalled, setFlushCalled] = useState(false);
  const [decidedRound, setDecidedRound] = useState<number | null>(null);

  // Reset per round (Odd Bird runs one round, but this keeps the controller correct on replay).
  useEffect(() => {
    setFlushCalled(false);
    setDecidedRound(null);
  }, [round]);

  const isOddBird = card?.role === 'odd-bird';
  const decided = decidedRound === round;

  // The player's secret card - always shown at the top while a round is live, never broadcast.
  let cardPanel = null;
  if (card) {
    let cardBody;
    if (isOddBird) {
      cardBody = (
        <>
          <Badge variant="danger" className="w-fit">
            You are the odd bird
          </Badge>
          <p className="text-body text-text">
            You do not know the roost. Blend in, bluff your answers, and work out where everyone
            else is.
          </p>
        </>
      );
    } else {
      const roost = card.role === 'flock' ? card.roost : '';
      const perch = card.role === 'flock' ? card.perch : '';
      cardBody = (
        <>
          <Badge variant="primary" className="w-fit">
            The roost
          </Badge>
          <p className="text-h3 text-text">{roost}</p>
          <p className="text-body-sm text-text-muted">
            Your perch: <span className="font-medium text-secondary">{perch}</span>
          </p>
        </>
      );
    }
    cardPanel = (
      <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4">{cardBody}</div>
    );
  }

  if (phase === 'collecting') {
    let flushControl = (
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          onMove(round, 'flush');
          setFlushCalled(true);
        }}
      >
        Call the flush
      </Button>
    );
    if (flushCalled) {
      flushControl = (
        <p role="status" className="text-body-sm text-success">
          Flush called - the vote is opening.
        </p>
      );
    }
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {cardPanel}
        <p className="text-body-sm text-text-muted">
          Ask each other pointed questions out loud. When the flock is ready to vote, anyone can
          call the flush.
        </p>
        {flushControl}
      </section>
    );
  }

  if (phase === 'guessing') {
    const flush = pickFlush(state.reveals);
    let guessBody;
    if (isOddBird) {
      let roostChoices;
      if (decided) {
        roostChoices = (
          <p role="status" className="text-body-sm text-success">
            Guess locked in! Waiting for the flock...
          </p>
        );
      } else {
        roostChoices = (
          <div className="flex flex-col gap-2">
            {(flush?.roostOptions ?? []).map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                onClick={() => {
                  onVote(round, `${ROOST_GUESS_TARGET_PREFIX}${option.id}`, true);
                  setDecidedRound(round);
                }}
              >
                {option.name}
              </Button>
            ))}
          </div>
        );
      }
      guessBody = (
        <>
          <p className="text-body text-text">Guess the roost to steal the win:</p>
          {roostChoices}
        </>
      );
    } else {
      let accusations;
      if (decided) {
        accusations = (
          <p role="status" className="text-body-sm text-success">
            Accusation locked in! Waiting for the flock...
          </p>
        );
      } else {
        accusations = (
          <div className="flex flex-col gap-2">
            {(flush?.players ?? [])
              .filter((id) => id !== me)
              .map((id) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onVote(round, id, true);
                    setDecidedRound(round);
                  }}
                >
                  {nicknameOf(players, id)}
                </Button>
              ))}
          </div>
        );
      }
      guessBody = (
        <>
          <p className="text-body text-text">Who is the odd bird?</p>
          {accusations}
        </>
      );
    }
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {cardPanel}
        {guessBody}
      </section>
    );
  }

  if (showResults && phase === 'complete') {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (showResults && phase === 'leaderboard') {
    const hostHint = isHost ? 'Tap Next to wrap up.' : 'Waiting for the host.';
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <Leaderboard standings={state.standings} me={me} />
        <p className="text-body-sm text-text-muted">{hostHint}</p>
      </section>
    );
  }

  const fallbackLine =
    phase === 'complete'
      ? 'The game is over - see the results on the viewer.'
      : 'Watch the viewer - your card is coming up.';
  return <p className="text-body-sm text-text-muted">{fallbackLine}</p>;
}
