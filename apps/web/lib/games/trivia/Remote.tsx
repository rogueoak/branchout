'use client';

// The remote: the private controller a player acts on. It takes the free-text answer while the
// round collects, offers the dispute button to a player marked wrong during the engine's dispute
// window, and shows the ballot to the other players while a dispute is voted on. It never runs the
// timer or tallies - it sends frames and reflects the phase the engine reports.
//
// A remote-only player (no viewer pane beside them) also renders the shared in-round question card
// (spec 0069), the between-round leaderboard, and the final results, which an interactive player
// instead reads from the viewer pane beside it.
//
// The `state` frame carries `disputes` (the playerIds who actually raised a dispute this round -
// spec 0012), so the ballot is offered over exactly those players, minus the voter themselves.

import type { PlayerView } from '@branchout/protocol';
import { Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameState } from '../../game-state';
import { asTriviaPrompt, pickTriviaDisputeReveal, pickTriviaRoundReveal } from './protocol';
import { useMoveCountdown } from '../../use-move-countdown';
import { useDwellCountdown } from '../../use-dwell-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { TriviaQuestionCard } from './QuestionCard';
import { AnswerReveal } from './AnswerReveal';

interface RemotePaneProps {
  state: GameState;
  me: string;
  /**
   * True when the controller is the only pane on screen (a remote-only player). Then it must also
   * render the in-round question card, the between-round leaderboard, and the final results, which an
   * interactive player instead reads from the viewer pane beside it.
   */
  showResults?: boolean;
  /** True when the controller belongs to the host, who advances rounds itself (spec 0013). Used to
   * make between-round copy self-aware ("Tap Next when you're ready") instead of "waiting". */
  isHost?: boolean;
  onMove: (round: number, answer: string) => void;
  /** The generic vote action: a Trivia dispute is a self-target, a ballot targets the disputer. */
  onVote: (round: number, target: string, agree: boolean) => void;
}

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((player) => player.player === id)?.nickname ?? id;
}

export function RemotePane({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
  onVote,
}: RemotePaneProps) {
  const { phase, round, disputes } = state;
  // Decode the opaque prompt/reveal into Trivia shapes at the render boundary (spec 0023).
  const prompt = asTriviaPrompt(state.prompt);
  const reveal = pickTriviaRoundReveal(state.reveals);
  const disputeResult = pickTriviaDisputeReveal(state.reveals);
  const [answer, setAnswer] = useState('');
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);
  const [disputedRound, setDisputedRound] = useState<number | null>(null);
  const secondsLeft = useMoveCountdown(state.moveMsRemaining, state.round, state.paused);
  const dwellSecondsLeft = useDwellCountdown(state.autoAdvanceMsRemaining, phase, state.paused);

  // A new round clears the draft and the per-round submission flags.
  useEffect(() => {
    setAnswer('');
    setSubmittedRound(null);
    setDisputedRound(null);
  }, [round]);

  const wasMarkedWrong = reveal?.wrong.includes(me) ?? false;
  const submitted = submittedRound === round;

  // When the countdown hits zero, auto-submit whatever the player has typed (spec 0017). The engine
  // force-closes the round at the same moment; sending here is what makes a typed-but-unsent answer
  // count. Blank drafts send nothing (a non-submitter is marked wrong, same as before). Skip while
  // paused: `secondsLeft` can read 0 on a pause-at-expiry, and the engine drops a paused submit - so
  // sending would lose the draft while the UI falsely marks it sent.
  useEffect(() => {
    if (phase !== 'collecting' || state.paused || secondsLeft !== 0 || submittedRound === round) {
      return;
    }
    const trimmed = answer.trim();
    if (!trimmed) return;
    onMove(round, trimmed);
    setSubmittedRound(round);
  }, [secondsLeft, phase, state.paused, round, submittedRound, answer, onMove]);

  // "Time is up" only when the clock has truly run out (not merely paused at some remaining).
  const timeUp = secondsLeft === 0 && !state.paused;
  // A dispute goes to a vote of the *other* connected players; with none there is nobody to vote
  // and the engine can never uphold it, so the button would be a dead end in a solo game. Only
  // offer it when at least one other connected player exists (feedback 0015).
  const hasOtherVoters = state.players.some((p) => p.player !== me && p.connected);
  const canDispute = wasMarkedWrong && hasOtherVoters;

  function submit() {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onMove(round, trimmed);
    setSubmittedRound(round);
  }

  let submitStatus = null;
  if (submitted) {
    submitStatus = (
      <p role="status" className="text-body-sm text-success">
        {timeUp
          ? 'Answer locked in.'
          : 'Answer submitted. You can change it until the round closes.'}
      </p>
    );
  } else if (secondsLeft !== null && !state.paused) {
    submitStatus = (
      <p className="text-body-sm text-text-subtle">
        Your answer sends automatically when the timer ends.
      </p>
    );
  }

  // A remote-only player (no viewer pane beside them) reads the answer/reveal card here, so after
  // each question they see the very same AnswerReveal the interactive player reads from the viewer
  // (spec 0069, WS12): the answer as the focus with green/red correctness, plus the per-player
  // answers table. An interactive remote (showResults false) skips it - the viewer pane carries it.
  const revealCard =
    showResults && reveal ? (
      <AnswerReveal
        reveal={reveal}
        players={state.players}
        phase={phase}
        disputeResult={disputeResult}
        dwellSecondsLeft={dwellSecondsLeft}
      />
    ) : null;

  return (
    <section aria-label="Your controller" className="flex flex-col gap-4">
      {phase === 'collecting' ? (
        <div className="flex flex-col gap-3">
          {/* A remote-only player has no viewer pane beside them, so the question card (with the
              countdown and answered count) has to live here too or they answer blind. An interactive
              player reads it from the viewer instead. */}
          {showResults && prompt ? <TriviaQuestionCard state={state} prompt={prompt} /> : null}
          <label htmlFor="answer-input" className="text-body-sm font-medium text-text">
            Your answer
          </label>
          <div className="flex gap-2">
            <Input
              id="answer-input"
              value={answer}
              autoComplete="off"
              placeholder="Type your answer"
              disabled={timeUp}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              disabled={timeUp || !answer.trim()}
            >
              {submitted ? 'Resubmit' : 'Submit'}
            </Button>
          </div>
          {submitStatus}
        </div>
      ) : phase === 'disputing' ? (
        <div className="flex flex-col gap-3">
          {revealCard}
          {canDispute ? (
            <>
              <p className="text-body text-text">
                Your answer was marked wrong. Think it should count? Dispute quickly - the window is
                brief.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onVote(round, me, true);
                  setDisputedRound(round);
                }}
                disabled={disputedRound === round}
              >
                {disputedRound === round ? 'Dispute raised' : 'Dispute'}
              </Button>
            </>
          ) : wasMarkedWrong ? (
            // Marked wrong but nobody else is here to vote, so no dispute is possible - say so
            // plainly rather than dangling a vote that cannot happen for them (feedback 0015).
            <p className="text-body-sm text-text-muted">
              Your answer was marked wrong. With no one else here to vote, there is no dispute this
              round.
            </p>
          ) : (
            <p className="text-body-sm text-text-muted">
              {showResults
                ? 'A disputed round may go to a vote.'
                : 'The answer is on the viewer. A disputed round may go to a vote.'}
            </p>
          )}
        </div>
      ) : phase === 'voting' ? (
        <div className="flex flex-col gap-3">
          {revealCard}
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
                      onClick={() => onVote(round, id, true)}
                    >
                      Should count
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${name}'s answer should not count`}
                      onClick={() => onVote(round, id, false)}
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
          <Leaderboard
            standings={state.standings}
            me={me}
            autoAdvanceSecondsLeft={dwellSecondsLeft}
          />
          {/* With auto-advance on, the Leaderboard's "next round in x" is the message; only a
              host-advanced game (no dwell) needs the tap-Next / waiting copy. */}
          {dwellSecondsLeft === null ? (
            <p className="text-body-sm text-text-muted">
              {isHost
                ? 'Tap Next when you are ready for the next round.'
                : 'Waiting for the host to start the next round.'}
            </p>
          ) : null}
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
