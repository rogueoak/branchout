'use client';

// Zinger's remote: the private controller a player acts on. While the round collects it takes the
// player's zinger (and, if the engine rejects an empty one, lets them retype); while the face-off is
// live it offers the two zingers to vote on - and if THIS player is one of the two contestants it
// tells them to sit the vote out, since a face-off author cannot vote on their own face-off (the
// engine also ignores such a vote by author id as a backstop). It decides "am I a contestant" by
// author IDENTITY - the face-off payload names which two players are the authors - never by matching
// the player's own text against the options (two players who typed the same short answer must not
// disenfranchise each other). It never runs a timer or tallies; it sends frames and reflects the
// phase the engine reports.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asZingerPrompt, pickFaceOff } from './protocol';

export function ZingerRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
  onVote,
}: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asZingerPrompt(state.prompt);
  const [draft, setDraft] = useState('');
  // The zinger this player submitted this round, and the rounds they submitted / voted in. Reset each
  // round. `myZinger` tracks the submit/resend + rejected-empty UI, not the vote sit-out (that is
  // gated on author identity from the face-off payload, not on this text).
  const [myZinger, setMyZinger] = useState('');
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);
  const [votedRound, setVotedRound] = useState<number | null>(null);

  useEffect(() => {
    setDraft('');
    setMyZinger('');
    setSubmittedRound(null);
    setVotedRound(null);
  }, [round]);

  const trimmed = draft.trim();
  const submittedThisDraft = submittedRound === round && trimmed.length > 0 && trimmed === myZinger;
  // The engine rejects an empty zinger only for the submitter, via the move_rejected frame the reducer
  // stored in `state.rejected`. Show it while the draft still matches the rejected submission.
  const rejectedThisDraft =
    state.rejected !== null && submittedRound === round && trimmed === myZinger;

  function submit() {
    if (!trimmed) return;
    onMove(round, trimmed);
    setMyZinger(trimmed);
    setSubmittedRound(round);
  }

  if (phase === 'collecting') {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {showResults && prompt ? (
          <div className="flex flex-col gap-2">
            <Badge variant="info" className="w-fit">
              Round {prompt.round}
            </Badge>
            <h2 className="text-h3 text-text">{prompt.setup}</h2>
          </div>
        ) : null}
        <label htmlFor="zinger-input" className="text-body-sm font-medium text-text">
          Write your zinger
        </label>
        <div className="flex gap-2">
          <Input
            id="zinger-input"
            value={draft}
            autoComplete="off"
            placeholder="Your funniest answer"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <Button type="button" variant="primary" onClick={submit} disabled={!trimmed}>
            {submittedThisDraft && !rejectedThisDraft ? 'Resend' : 'Submit'}
          </Button>
        </div>
        {rejectedThisDraft ? (
          <Badge variant="danger" className="w-fit" role="alert">
            {state.rejected} - try again.
          </Badge>
        ) : submittedThisDraft ? (
          <p role="status" className="text-body-sm text-success">
            Zinger submitted! Waiting for the others...
          </p>
        ) : (
          <p className="text-body-sm text-text-subtle">
            Keep it short and funny - you might land in the face-off.
          </p>
        )}
      </section>
    );
  }

  if (phase === 'guessing') {
    const faceOff = pickFaceOff(state.reveals);
    const options = faceOff?.options ?? [];
    // A face-off author cannot vote on their own face-off. Gate the sit-out on IDENTITY - is my
    // playerId one of the two contestant authors the engine named - never on my text. Matching text
    // would wrongly disenfranchise a non-author who happened to type the same short answer. The engine
    // also ignores a self-vote by author id as a backstop.
    const isAuthor = me != null && (faceOff?.authorIds.includes(me) ?? false);
    const voted = votedRound === round;
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {/* A remote-only player has no viewer on their screen, so re-show the setup they vote on. */}
        {showResults && faceOff?.setup ? (
          <h2 className="text-h3 text-text">{faceOff.setup}</h2>
        ) : null}
        {isAuthor ? (
          <p role="status" className="text-body-sm text-text-muted">
            Your zinger is in this face-off - sit this vote out and see how it lands.
          </p>
        ) : (
          <>
            <p className="text-body text-text">Which zinger landed hardest?</p>
            {voted ? (
              <p role="status" className="text-body-sm text-success">
                Vote locked in! Waiting for the others...
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onVote(round, option.id, true);
                      setVotedRound(round);
                    }}
                  >
                    {option.text}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    );
  }

  if (showResults && phase === 'complete') {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (showResults && phase === 'leaderboard') {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <Leaderboard standings={state.standings} me={me} />
        <p className="text-body-sm text-text-muted">
          {isHost
            ? 'Tap Next when you are ready for the next round.'
            : 'Waiting for the host to start the next round.'}
        </p>
      </section>
    );
  }

  return (
    <p className="text-body-sm text-text-muted">
      {phase === 'complete'
        ? 'The game is over - see the results on the viewer.'
        : 'Watch the viewer - the next setup is coming up.'}
    </p>
  );
}
