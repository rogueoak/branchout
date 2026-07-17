'use client';

// Same Branch remote: the private controller a player acts on. If this player is the Reader, it shows
// the hidden bud (read from `state.private`, the spec 0052 secret delivered only to them) on the branch
// and takes their one-line hunch. Everyone else drags the sap line and locks in a guess. It never runs
// a timer or tallies - it sends frames and reflects the phase the engine reports.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { BranchDial, type DialMarker } from './BranchDial';
import { asSameBranchPrompt, asSameBranchSecret } from './protocol';

export function SameBranchRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
}: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asSameBranchPrompt(state.prompt);
  const secret = asSameBranchSecret(state.private);
  const isReader = prompt?.reader === me;

  const [hunch, setHunch] = useState('');
  const [position, setPosition] = useState<number | null>(null);
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);

  // Reset all per-round draft state when a new round lands.
  useEffect(() => {
    setHunch('');
    setPosition(null);
    setSubmittedRound(null);
  }, [round]);

  const trimmedHunch = hunch.trim();
  const submitted = submittedRound === round;
  // The engine rejects a bad move (empty hunch / no position) only for the submitter, via the
  // move_rejected frame the reducer stored in `state.rejected`.
  const rejected = state.rejected !== null && submittedRound === round;

  if (phase === 'collecting' && prompt) {
    if (isReader) {
      const markers: DialMarker[] = secret
        ? [{ position: secret.bud, label: 'the bud', tone: 'bud' }]
        : [];
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <Badge variant="primary" className="w-fit">
            You are the Reader
          </Badge>
          {secret ? (
            <>
              <p className="text-body-sm text-text-muted">
                Only you can see the bud. Give a one-line hunch that fits where it sits.
              </p>
              <BranchDial
                left={secret.left}
                right={secret.right}
                value={secret.bud}
                markers={markers}
                ariaLabel="The bud on the branch (only you can see this)"
              />
            </>
          ) : (
            <p className="text-body-sm text-text-subtle">Revealing the bud to you...</p>
          )}
          <label htmlFor="hunch-input" className="text-body-sm font-medium text-text">
            Your hunch
          </label>
          <div className="flex gap-2">
            <Input
              id="hunch-input"
              value={hunch}
              autoComplete="off"
              maxLength={120}
              placeholder="A one-line clue for the bud"
              onChange={(event) => setHunch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && trimmedHunch) {
                  onMove(round, trimmedHunch);
                  setSubmittedRound(round);
                }
              }}
            />
            <Button
              type="button"
              variant="primary"
              disabled={!trimmedHunch}
              onClick={() => {
                onMove(round, trimmedHunch);
                setSubmittedRound(round);
              }}
            >
              {submitted && !rejected ? 'Resend' : 'Send'}
            </Button>
          </div>
          {rejected ? (
            <Badge variant="danger" className="w-fit" role="alert">
              {state.rejected} - try again.
            </Badge>
          ) : submitted ? (
            <p role="status" className="text-body-sm text-success">
              Hunch sent! Waiting for the grove to guess...
            </p>
          ) : (
            <p className="text-body-sm text-text-subtle">
              Keep it to one line - not too obvious, not too cryptic.
            </p>
          )}
        </section>
      );
    }

    // A guesser: drag the sap line, then lock in.
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body text-text">
          Listen for the Reader&apos;s hunch, then move the sap line to where you think the bud is.
          The hunch and the bud show on the viewer at the reveal.
        </p>
        <BranchDial
          left={prompt.left}
          right={prompt.right}
          value={position}
          onChange={(next) => setPosition(next)}
          disabled={submitted}
          ariaLabel="Move the sap line to your guess"
        />
        {submitted && !rejected ? (
          <p role="status" className="text-body-sm text-success">
            Locked in at {position}. Waiting for the others...
          </p>
        ) : (
          <Button
            type="button"
            variant="primary"
            disabled={position === null}
            onClick={() => {
              if (position === null) return;
              onMove(round, String(position));
              setSubmittedRound(round);
            }}
          >
            Lock in my guess
          </Button>
        )}
        {rejected ? (
          <Badge variant="danger" className="w-fit" role="alert">
            {state.rejected}
          </Badge>
        ) : null}
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
        : 'Watch the viewer - the next branch is coming up.'}
    </p>
  );
}
