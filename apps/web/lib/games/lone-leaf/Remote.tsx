'use client';

// Lone Leaf's remote: the private controller a player acts on. This is the ONLY place the secret
// hidden word appears - it reads `state.private` (spec 0052), which the engine delivered ONLY to
// non-Seekers, so the Seeker's device has no word to show. While collecting, a non-Seeker sees their
// word and writes a one-word clue; the Seeker just waits. While guessing, the Seeker types their one
// guess and everyone else waits. It never runs a timer or tallies - it sends frames and reflects the
// engine's phase.
//
// A remote-only player (no viewer pane beside them) also renders the shared prompt card and, after
// each round, the same result reveal the viewer shows (WS17), so the remote sees the reveal too.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { useDwellCountdown } from '../../use-dwell-countdown';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asLoneLeafPrompt, asLoneLeafSecret, pickResult, pickSurvivors } from './protocol';
import { LoneLeafPromptCard } from './PromptCard';
import { ResultReveal } from './ResultReveal';

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
  const dwellSecondsLeft = useDwellCountdown(state.autoAdvanceMsRemaining, phase, state.paused);

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

  // A remote-only player has no viewer pane beside them, so the prompt card (round, theme, countdown)
  // has to live here too or they act blind. An interactive player reads it from the viewer instead.
  const promptCard =
    showResults && prompt ? (
      <LoneLeafPromptCard
        state={state}
        round={prompt.round}
        category={prompt.category}
        heading={iAmSeeker ? 'You are the Seeker' : 'Write your clue'}
      />
    ) : null;

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
    // The Seeker writes no clue - they must not even see the word. Just wait.
    if (iAmSeeker) {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          {promptCard}
          {/* The prompt card heading already says "You are the Seeker"; only label it here when there
              is no prompt card (an interactive Seeker reads the heading from the viewer instead). */}
          {promptCard ? null : (
            <Badge variant="info" className="w-fit">
              You are the Seeker
            </Badge>
          )}
          <p className="text-body text-text">
            You cannot see the word. Sit tight while everyone writes their clues.
          </p>
        </section>
      );
    }
    const wordPanel = secret ? (
      <div className="flex flex-col gap-1 rounded-md bg-surface-raised p-3">
        <span className="text-caption text-text-subtle">
          The hidden word (only you and your group see it)
        </span>
        <span className="text-h3 text-secondary">{secret.seed}</span>
      </div>
    ) : (
      <p className="text-body-sm text-text-subtle">Waiting for the word...</p>
    );
    const submitLabel = submittedThisRound && !rejectedThisRound ? 'Resend' : 'Submit';
    let clueStatus = (
      <p className="text-body-sm text-text-subtle">
        Pick a word that points at the hidden word but that no one else will think of.
      </p>
    );
    if (rejectedThisRound) {
      clueStatus = (
        <Badge variant="danger" className="w-fit" role="alert">
          {state.rejected} - try again.
        </Badge>
      );
    } else if (submittedThisRound) {
      clueStatus = (
        <p role="status" className="text-body-sm text-success">
          Clue sent! Matching clues cancel out - fingers crossed yours is unique.
        </p>
      );
    }
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {promptCard}
        {wordPanel}
        <label htmlFor="leaf-input" className="text-body-sm font-medium text-text">
          Write your clue (one word)
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
        {clueStatus}
      </section>
    );
  }

  if (phase === 'guessing') {
    if (!iAmSeeker) {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <p role="status" className="text-body text-text-muted">
            Your clues are in. The Seeker is making the guess now.
          </p>
        </section>
      );
    }
    const survivors = pickSurvivors(state.reveals);
    const survivorWords = survivors?.survivors ?? [];
    const decided = decidedRound === round;
    const clueList =
      survivorWords.length === 0 ? (
        <p className="text-body-sm text-text-subtle">
          Every clue cancelled out - take your best guess anyway.
        </p>
      ) : (
        <ul aria-label="Remaining clues" className="flex flex-wrap gap-2">
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
          Your guess
        </label>
        <div className="flex gap-2">
          <Input
            id="guess-input"
            value={draft}
            autoComplete="off"
            placeholder="The hidden word"
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
        {/* The guess phase is timed (the engine's 60s guess window), and a remote-only Seeker is the
            sole actor with no viewer beside them - so the prompt card (with the countdown) has to live
            here too, or they guess blind on time. An interactive Seeker reads it from the viewer. */}
        {showResults && prompt ? (
          <LoneLeafPromptCard
            state={state}
            round={prompt.round}
            category={prompt.category}
            heading="Your remaining clues"
          >
            {clueList}
          </LoneLeafPromptCard>
        ) : (
          <>
            <p className="text-body font-medium text-text">Your remaining clues</p>
            {clueList}
          </>
        )}
        {guessBody}
      </section>
    );
  }

  if (showResults && phase === 'complete') {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (showResults && phase === 'leaderboard') {
    // The remote-only player reads the very same result reveal the viewer shows, so after each round
    // they see the hidden word, the guess, and each clue's fate (WS17).
    const result = pickResult(state.reveals);
    const revealBlock =
      result !== null ? (
        <ResultReveal result={result} players={state.players} dwellSecondsLeft={dwellSecondsLeft} />
      ) : null;
    const nextHint =
      dwellSecondsLeft === null ? (
        <p className="text-body-sm text-text-muted">
          {isHost
            ? 'Tap Next when you are ready for the next round.'
            : 'Waiting for the host to start the next round.'}
        </p>
      ) : null;
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {revealBlock}
        <Leaderboard
          standings={state.standings}
          me={me}
          autoAdvanceSecondsLeft={dwellSecondsLeft}
        />
        {nextHint}
      </section>
    );
  }

  const fallbackLine =
    phase === 'complete'
      ? 'The game is over - see the results on the viewer.'
      : 'Watch the viewer - the next word is coming up.';
  return <p className="text-body-sm text-text-muted">{fallbackLine}</p>;
}
