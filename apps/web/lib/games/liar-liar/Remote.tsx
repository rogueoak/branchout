'use client';

// Liar Liar's remote: the private controller a player acts on. While the round collects it takes the
// player's lie (and, if the engine rejects it as a duplicate or the truth, shows the vague "someone
// already submitted that" and lets them retype); while guessing it offers the options to pick the
// truth from - hiding the player's own lie, which they cannot pick. It never runs a timer or tallies;
// it sends frames and reflects the phase the engine reports.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLiarLiarPrompt, pickOptions } from './protocol';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function LiarLiarRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onAnswer,
  onVote,
}: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asLiarLiarPrompt(state.prompt);
  const [draft, setDraft] = useState('');
  // The lie this player submitted this round, and the round they submitted / guessed in. Reset each
  // round. `myLie` also gates hiding the player's own option during the guess.
  const [myLie, setMyLie] = useState('');
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);
  const [guessedRound, setGuessedRound] = useState<number | null>(null);

  useEffect(() => {
    setDraft('');
    setMyLie('');
    setSubmittedRound(null);
    setGuessedRound(null);
  }, [round]);

  const trimmed = draft.trim();
  const submittedThisDraft = submittedRound === round && trimmed.length > 0 && trimmed === myLie;
  // The engine rejects a lie (a duplicate or the truth) only for the submitter, via the
  // answer_rejected frame the reducer stored in `state.rejected`. Show it while the draft still
  // matches the rejected submission; editing the draft dismisses it so a retype reads clean.
  const rejectedThisDraft =
    state.rejected !== null && submittedRound === round && trimmed === myLie;

  function submit() {
    if (!trimmed) return;
    onAnswer(round, trimmed);
    setMyLie(trimmed);
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
            <h2 className="text-h3 text-text">{prompt.clue}</h2>
          </div>
        ) : null}
        <label htmlFor="lie-input" className="text-body-sm font-medium text-text">
          Write your lie
        </label>
        <div className="flex gap-2">
          <Input
            id="lie-input"
            value={draft}
            autoComplete="off"
            placeholder="A convincing fake answer"
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
            {state.rejected} - try another.
          </Badge>
        ) : submittedThisDraft ? (
          <p role="status" className="text-body-sm text-success">
            Lie submitted! Waiting for the others...
          </p>
        ) : (
          <p className="text-body-sm text-text-subtle">
            Write something no one else will think of - but not the real answer.
          </p>
        )}
      </section>
    );
  }

  if (phase === 'guessing') {
    const guess = pickOptions(state.reveals);
    const options = guess?.options ?? [];
    // A player cannot pick their own lie; hide it - but ONLY when their submission was accepted. A
    // lie that was rejected (a duplicate/the truth) and abandoned must not hide the matching real
    // option from this player. The engine also ignores a self-pick by author id as a backstop.
    const ownLie =
      submittedRound === round && state.rejected === null && myLie ? normalize(myLie) : null;
    const guessable = ownLie
      ? options.filter((option) => normalize(option.text) !== ownLie)
      : options;
    const guessed = guessedRound === round;
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {/* A remote-only player has no viewer on their screen, so re-show the clue they are guessing on. */}
        {showResults && guess?.clue ? <h2 className="text-h3 text-text">{guess.clue}</h2> : null}
        <p className="text-body text-text">Which one is the truth?</p>
        {guessed ? (
          <p role="status" className="text-body-sm text-success">
            Locked in! Waiting for the others...
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {guessable.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                onClick={() => {
                  onVote(round, option.id, true);
                  setGuessedRound(round);
                }}
              >
                {option.text}
              </Button>
            ))}
          </div>
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
        : 'Watch the viewer - the next clue is coming up.'}
    </p>
  );
}
