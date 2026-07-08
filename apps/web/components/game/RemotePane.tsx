'use client';

// The remote: the private controller a player acts on. It takes the free-text answer while the
// round collects, offers the dispute button to a player marked wrong during the engine's 10s
// window, and shows the ballot to the other players while a dispute is voted on. It never runs the
// timer or tallies - it sends frames and reflects the phase the engine reports.
//
// The `state` frame carries `disputes` (the playerIds who actually raised a dispute this round -
// spec 0012), so the ballot is offered over exactly those players, minus the voter themselves.

import type { PlayerView } from '@branchout/protocol';
import { Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameState } from '../../lib/game-state';
import { FinalResults } from './FinalResults';
import { Leaderboard } from './Leaderboard';

interface RemotePaneProps {
  state: GameState;
  me: string;
  /**
   * True when the controller is the only pane on screen (a remote-only player). Then it must also
   * render the between-round leaderboard and the final results, which an interactive player instead
   * reads from the viewer pane beside it.
   */
  showResults?: boolean;
  /** True when the controller belongs to the host, who advances rounds itself (spec 0013). Used to
   * make between-round copy self-aware ("Tap Next when you're ready") instead of "waiting". */
  isHost?: boolean;
  onAnswer: (round: number, answer: string) => void;
  onDispute: (round: number) => void;
  onBallot: (round: number, target: string, agree: boolean) => void;
}

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function RemotePane({
  state,
  me,
  showResults = false,
  isHost = false,
  onAnswer,
  onDispute,
  onBallot,
}: RemotePaneProps) {
  const { phase, reveal, round, disputes } = state;
  const [answer, setAnswer] = useState('');
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);
  const [disputedRound, setDisputedRound] = useState<number | null>(null);

  // A new round clears the draft and the per-round submission flags.
  useEffect(() => {
    setAnswer('');
    setSubmittedRound(null);
    setDisputedRound(null);
  }, [round]);

  const wasMarkedWrong = reveal?.wrong.includes(me) ?? false;
  const submitted = submittedRound === round;

  function submit() {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onAnswer(round, trimmed);
    setSubmittedRound(round);
  }

  return (
    <section aria-label="Your controller" className="flex flex-col gap-4">
      {phase === 'collecting' ? (
        <div className="flex flex-col gap-3">
          <label htmlFor="answer-input" className="text-body-sm font-medium text-text">
            Your answer
          </label>
          <div className="flex gap-2">
            <Input
              id="answer-input"
              value={answer}
              autoComplete="off"
              placeholder="Type your answer"
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <Button type="button" variant="primary" onClick={submit} disabled={!answer.trim()}>
              {submitted ? 'Resubmit' : 'Submit'}
            </Button>
          </div>
          {submitted ? (
            <p role="status" className="text-body-sm text-success">
              Answer submitted. You can change it until the round closes.
            </p>
          ) : null}
        </div>
      ) : phase === 'disputing' ? (
        <div className="flex flex-col gap-3">
          {wasMarkedWrong ? (
            <>
              <p className="text-body text-text">
                Your answer was marked wrong. Think it should count? Dispute quickly - the window is
                brief.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onDispute(round);
                  setDisputedRound(round);
                }}
                disabled={disputedRound === round}
              >
                {disputedRound === round ? 'Dispute raised' : 'Dispute'}
              </Button>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">
              The answer is on the viewer. A disputed round may go to a vote.
            </p>
          )}
        </div>
      ) : phase === 'voting' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-text">Should a disputed answer count?</p>
          {disputes
            .filter((id) => id !== me)
            .map((id) => {
              const name = nicknameOf(state.players, id);
              return (
                <div key={id} className="flex items-center justify-between gap-3">
                  <span className="text-body-sm text-text">{name}</span>
                  <span className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${name}'s answer should count`}
                      onClick={() => onBallot(round, id, true)}
                    >
                      Should count
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${name}'s answer should not count`}
                      onClick={() => onBallot(round, id, false)}
                    >
                      Should not
                    </Button>
                  </span>
                </div>
              );
            })}
          {disputes.filter((id) => id !== me).length === 0 ? (
            <p className="text-body-sm text-text-muted">Nothing for you to vote on this round.</p>
          ) : null}
        </div>
      ) : showResults && phase === 'complete' ? (
        <FinalResults standings={state.standings} me={me} />
      ) : showResults && phase === 'leaderboard' ? (
        <div className="flex flex-col gap-3">
          <Leaderboard standings={state.standings} me={me} />
          <p className="text-body-sm text-text-muted">
            {isHost
              ? 'Tap Next when you are ready for the next round.'
              : 'Waiting for the host to start the next round.'}
          </p>
        </div>
      ) : (
        <p className="text-body-sm text-text-muted">
          {phase === 'complete'
            ? 'The game is over - see the results on the viewer.'
            : 'Watch the viewer - the next question is coming up.'}
        </p>
      )}
    </section>
  );
}
