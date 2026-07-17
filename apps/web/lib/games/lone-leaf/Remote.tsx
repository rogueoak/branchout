'use client';

// Lone Leaf's remote: the private controller a player acts on. This is the ONLY place the secret seed
// appears - it reads `state.private` (spec 0052), which the engine delivered ONLY to non-Seekers, so
// the Seeker's device has no seed to show. While collecting, a non-Seeker sees their seed and writes a
// one-word leaf; the Seeker just waits. While guessing, the Seeker types their one guess and everyone
// else waits. It never runs a timer or tallies - it sends frames and reflects the engine's phase.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLoneLeafPrompt, asLoneLeafSecret, pickSurvivors } from './protocol';

export function LoneLeafRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
  onVote,
}: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asLoneLeafPrompt(state.prompt);
  const secret = asLoneLeafSecret(state.private);
  const iAmSeeker = prompt?.seeker === me;

  const [draft, setDraft] = useState('');
  const [submittedRound, setSubmittedRound] = useState<number | null>(null);
  const [decidedRound, setDecidedRound] = useState<number | null>(null);

  useEffect(() => {
    setDraft('');
    setSubmittedRound(null);
    setDecidedRound(null);
  }, [round]);

  const trimmed = draft.trim();
  const submittedThisRound = submittedRound === round;
  const rejectedThisRound = state.rejected !== null && submittedRound === round;

  function submitLeaf() {
    if (!trimmed) return;
    onMove(round, trimmed);
    setSubmittedRound(round);
  }

  function submitGuess() {
    if (!trimmed) return;
    // The Seeker's guess rides the vote frame's target (free text); the engine reads it while guessing.
    onVote(round, trimmed, true);
    setDecidedRound(round);
  }

  if (phase === 'collecting') {
    // The Seeker writes no leaf - they must not even see the seed. Just wait.
    if (iAmSeeker) {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <Badge variant="info" className="w-fit">
            You are the Seeker
          </Badge>
          <p className="text-body text-text">
            You cannot see the seed. Sit tight while everyone writes their leaves.
          </p>
        </section>
      );
    }
    const seedPanel = secret ? (
      <div className="flex flex-col gap-1 rounded-md bg-surface-raised p-3">
        <span className="text-caption text-text-subtle">
          The seed (only you and the grove see it)
        </span>
        <span className="text-h3 text-secondary">{secret.seed}</span>
      </div>
    ) : (
      <p className="text-body-sm text-text-subtle">Waiting for the seed...</p>
    );
    const submitLabel = submittedThisRound && !rejectedThisRound ? 'Resend' : 'Submit';
    let leafStatus = (
      <p className="text-body-sm text-text-subtle">
        Pick a word that points at the seed but that no one else will think of.
      </p>
    );
    if (rejectedThisRound) {
      leafStatus = (
        <Badge variant="danger" className="w-fit" role="alert">
          {state.rejected} - try again.
        </Badge>
      );
    } else if (submittedThisRound) {
      leafStatus = (
        <p role="status" className="text-body-sm text-success">
          Leaf sent! Matching leaves will wilt - fingers crossed yours is unique.
        </p>
      );
    }
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {seedPanel}
        <label htmlFor="leaf-input" className="text-body-sm font-medium text-text">
          Write one leaf (a single word)
        </label>
        <div className="flex gap-2">
          <Input
            id="leaf-input"
            value={draft}
            autoComplete="off"
            placeholder="One word"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitLeaf();
            }}
          />
          <Button type="button" variant="primary" onClick={submitLeaf} disabled={!trimmed}>
            {submitLabel}
          </Button>
        </div>
        {leafStatus}
      </section>
    );
  }

  if (phase === 'guessing') {
    if (!iAmSeeker) {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <p role="status" className="text-body text-text-muted">
            Your leaves are in. The Seeker is making the guess now.
          </p>
        </section>
      );
    }
    const survivors = pickSurvivors(state.reveals);
    const survivorWords = survivors?.survivors ?? [];
    const decided = decidedRound === round;
    const leafList =
      survivorWords.length === 0 ? (
        <p className="text-body-sm text-text-subtle">
          Every leaf wilted - take your best guess anyway.
        </p>
      ) : (
        <ul aria-label="Surviving leaves" className="flex flex-wrap gap-2">
          {survivorWords.map((word, index) => (
            <li
              key={`${word}-${index}`}
              className="rounded-md bg-surface-raised px-3 py-1.5 text-body text-text"
            >
              {word}
            </li>
          ))}
        </ul>
      );
    const guessBody = decided ? (
      <p role="status" className="text-body-sm text-success">
        Guess locked in!
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        <label htmlFor="guess-input" className="text-body-sm font-medium text-text">
          Your one guess
        </label>
        <div className="flex gap-2">
          <Input
            id="guess-input"
            value={draft}
            autoComplete="off"
            placeholder="The seed word"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitGuess();
            }}
          />
          <Button type="button" variant="primary" onClick={submitGuess} disabled={!trimmed}>
            Guess
          </Button>
        </div>
      </div>
    );
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body font-medium text-text">Your surviving leaves</p>
        {leafList}
        {guessBody}
      </section>
    );
  }

  if (showResults && phase === 'complete') {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (showResults && phase === 'leaderboard') {
    const nextHint = isHost
      ? 'Tap Next when you are ready for the next round.'
      : 'Waiting for the host to start the next round.';
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <Leaderboard standings={state.standings} me={me} />
        <p className="text-body-sm text-text-muted">{nextHint}</p>
      </section>
    );
  }

  const fallbackLine =
    phase === 'complete'
      ? 'The game is over - see the results on the viewer.'
      : 'Watch the viewer - the next seed is coming up.';
  return <p className="text-body-sm text-text-muted">{fallbackLine}</p>;
}
