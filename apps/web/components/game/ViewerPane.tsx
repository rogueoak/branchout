'use client';

// The viewer: the shared screen everyone watches. It renders the current phase of engine state -
// the prompt while answering, the reveal and scoring once the round closes, the dispute vote in
// progress, the between-round leaderboard, and the final results. It reads state; it never drives
// the game.

import type { PlayerView } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import type { GameState } from '../../lib/game-state';
import { FinalResults } from './FinalResults';
import { Leaderboard } from './Leaderboard';

interface ViewerPaneProps {
  state: GameState;
  me?: string;
}

/** Map a player id to a nickname from the current roster, falling back to the id. */
function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function ViewerPane({ state, me }: ViewerPaneProps) {
  const { phase, prompt, reveal, disputeResult, standings, players } = state;

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-5">
      {state.paused ? (
        <Badge variant="warning" className="w-fit">
          Paused by the host
        </Badge>
      ) : null}

      {phase === 'complete' ? (
        <FinalResults standings={standings} me={me} />
      ) : phase === 'leaderboard' ? (
        <div className="flex flex-col gap-3">
          <Leaderboard standings={standings} me={me} />
          <p className="text-body-sm text-text-muted">
            Waiting for the host to start the next round.
          </p>
        </div>
      ) : prompt ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Round {prompt.round}</Badge>
            <Badge variant="neutral">{prompt.category}</Badge>
            <Badge variant="neutral">Difficulty {prompt.difficulty}</Badge>
          </div>
          <h2 className="text-h2 text-text">{prompt.question}</h2>

          {reveal ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-raised p-4">
              <p className="text-body-sm text-text-muted">Answer</p>
              <p className="text-h4 text-text">{reveal.answers[0] ?? 'No answer'}</p>
              {reveal.answers.length > 1 ? (
                <p className="text-body-sm text-text-muted">
                  Also accepted: {reveal.answers.slice(1).join(', ')}
                </p>
              ) : null}
              <p className="text-body-sm text-success">
                {reveal.correct.length === 0
                  ? 'Nobody got it.'
                  : `Correct: ${reveal.correct.map((id) => nicknameOf(players, id)).join(', ')}`}
              </p>
              {phase === 'voting' ? (
                <p className="text-body-sm text-text-muted" role="status">
                  A dispute is being voted on.
                </p>
              ) : null}
              {disputeResult && disputeResult.upheld.length > 0 ? (
                <p className="text-body-sm text-text">
                  Dispute upheld:{' '}
                  {disputeResult.upheld.map((id) => nicknameOf(players, id)).join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-h3 text-text">Get ready</h2>
          <p className="text-body text-text-muted">The first question is on its way.</p>
        </div>
      )}
    </section>
  );
}
