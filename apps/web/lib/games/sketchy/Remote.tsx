'use client';

// Sketchy's remote: the private controller a player acts on (spec 0063). Its content depends on the
// round stage the engine reports:
//   - DRAW round (`collecting`, prompt.stage === 'draw'): show the player's OWN secret seed (read from
//     `state.private`, spec 0052) and the drawing surface; on submit, serialize the sketch to the move
//     channel.
//   - SKETCH round (`collecting`, prompt.stage === 'sketch'): re-show the featured sketch (read-only)
//     and take a decoy (a fake seed). The featured author instead waits. A rejected decoy (a duplicate
//     or the true seed) shows the vague notice and lets them retype.
//   - SKETCH round (`guessing`): offer the shuffled options to pick the true seed from, hiding the
//     player's own decoy, which they cannot pick.
// It never runs a timer or tallies; it sends frames and reflects the phase the engine reports.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { Leaderboard } from '../../../components/game/Leaderboard';
import { asSketchyPrompt, asSketchySeedSecret, pickOptions } from './protocol';
import { DrawCanvas } from './DrawCanvas';
import { SketchReplay } from './SketchReplay';
import { emptySketch, isDrawn, serializeSketch, type Sketch } from './strokes';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function SketchyRemote({
  state,
  me,
  showResults = false,
  isHost = false,
  onMove,
  onVote,
}: GameRemoteProps) {
  const { phase, round } = state;
  const prompt = asSketchyPrompt(state.prompt);
  const secret = asSketchySeedSecret(state.private);

  // Draw-stage local state: the in-progress sketch and whether it was submitted this round.
  const [sketch, setSketch] = useState<Sketch>(emptySketch());
  const [drawSubmittedRound, setDrawSubmittedRound] = useState<number | null>(null);
  // Decoy-stage local state.
  const [draft, setDraft] = useState('');
  const [myDecoy, setMyDecoy] = useState('');
  const [decoyRound, setDecoyRound] = useState<number | null>(null);
  const [guessedRound, setGuessedRound] = useState<number | null>(null);

  useEffect(() => {
    setSketch(emptySketch());
    setDrawSubmittedRound(null);
    setDraft('');
    setMyDecoy('');
    setDecoyRound(null);
    setGuessedRound(null);
  }, [round]);

  // ---- DRAW round ----
  if (phase === 'collecting' && prompt?.stage === 'draw') {
    const submitted = drawSubmittedRound === round;
    const canSubmit = isDrawn(sketch) && !submitted;
    const seedBadge = secret ? (
      <Badge variant="primary" className="w-fit">
        {secret.seed}
      </Badge>
    ) : (
      <p className="text-body-sm text-text-subtle">Waiting for your secret seed...</p>
    );
    const submitLabel = submitted ? 'Resend sketch' : 'Submit sketch';
    const drawFooter = submitted ? (
      <p role="status" className="text-body-sm text-success">
        Sketch submitted! Waiting for the others...
      </p>
    ) : (
      <p className="text-body-sm text-text-subtle">
        Draw your seed with a twig. Others will guess what it was.
      </p>
    );
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-body-sm font-medium text-text">Your seed - draw it!</span>
          {seedBadge}
        </div>
        <DrawCanvas sketch={sketch} onChange={setSketch} disabled={submitted} />
        <Button
          type="button"
          variant="primary"
          disabled={!canSubmit && !submitted}
          onClick={() => {
            if (!isDrawn(sketch)) return;
            onMove(round, serializeSketch(sketch));
            setDrawSubmittedRound(round);
          }}
        >
          {submitLabel}
        </Button>
        {drawFooter}
      </section>
    );
  }

  // ---- SKETCH round, decoy stage ----
  if (phase === 'collecting' && prompt?.stage === 'sketch') {
    const iAmFeatured = prompt.featured === me;
    if (iAmFeatured) {
      const ownSketch = prompt.sketch ? (
        <SketchReplay sketch={prompt.sketch} label="Your sketch" />
      ) : null;
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <p className="text-body text-text">This is your sketch! Sit tight.</p>
          {ownSketch}
          <p className="text-body-sm text-text-subtle">
            Everyone else is writing a fake seed for your drawing.
          </p>
        </section>
      );
    }
    const trimmed = draft.trim();
    const submitted = decoyRound === round && trimmed.length > 0 && trimmed === myDecoy;
    const rejected = state.rejected !== null && decoyRound === round && trimmed === myDecoy;
    const submit = () => {
      if (!trimmed) return;
      onMove(round, trimmed);
      setMyDecoy(trimmed);
      setDecoyRound(round);
    };
    const sketchToGuess = prompt.sketch ? (
      <SketchReplay sketch={prompt.sketch} label="The sketch to guess" />
    ) : null;
    const decoyButtonLabel = submitted && !rejected ? 'Resend' : 'Submit';
    let decoyFooter = (
      <p className="text-body-sm text-text-subtle">
        Write a fake seed good enough to fool the room - but not the real one.
      </p>
    );
    if (rejected) {
      decoyFooter = (
        <Badge variant="danger" className="w-fit" role="alert">
          {state.rejected} - try another.
        </Badge>
      );
    } else if (submitted) {
      decoyFooter = (
        <p role="status" className="text-body-sm text-success">
          Decoy submitted! Waiting for the others...
        </p>
      );
    }
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <p className="text-body-sm font-medium text-text">What was this a drawing of?</p>
        {sketchToGuess}
        <div className="flex gap-2">
          <Input
            id="sketchy-decoy-input"
            value={draft}
            autoComplete="off"
            placeholder="A convincing fake seed"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <Button type="button" variant="primary" onClick={submit} disabled={!trimmed}>
            {decoyButtonLabel}
          </Button>
        </div>
        {decoyFooter}
      </section>
    );
  }

  // ---- SKETCH round, guess stage ----
  if (phase === 'guessing') {
    const guess = pickOptions(state.reveals);
    const options = guess?.options ?? [];
    const iAmFeatured = guess?.featured === me;
    // A player cannot pick their own decoy; hide it - but only when accepted.
    const ownDecoy =
      decoyRound === round && state.rejected === null && myDecoy ? normalize(myDecoy) : null;
    const guessable = ownDecoy
      ? options.filter((option) => normalize(option.text) !== ownDecoy)
      : options;
    const guessed = guessedRound === round;
    if (iAmFeatured) {
      return (
        <section aria-label="Your controller" className="flex flex-col gap-3">
          <p className="text-body text-text">Your sketch is up for guessing - sit this one out.</p>
        </section>
      );
    }
    const guessSketch =
      showResults && guess?.sketch ? (
        <SketchReplay sketch={guess.sketch} label="The sketch to guess" />
      ) : null;
    const guessBody = guessed ? (
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
    );
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        {guessSketch}
        <p className="text-body text-text">Which one is the true seed?</p>
        {guessBody}
      </section>
    );
  }

  if (showResults && phase === 'complete') {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (showResults && phase === 'leaderboard') {
    const nextRoundHint = isHost
      ? 'Tap Next when you are ready for the next round.'
      : 'Waiting for the host to start the next round.';
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <Leaderboard standings={state.standings} me={me} />
        <p className="text-body-sm text-text-muted">{nextRoundHint}</p>
      </section>
    );
  }

  const fallbackLine =
    phase === 'complete'
      ? 'The game is over - see the results on the viewer.'
      : 'Watch the viewer - the next round is coming up.';
  return <p className="text-body-sm text-text-muted">{fallbackLine}</p>;
}
