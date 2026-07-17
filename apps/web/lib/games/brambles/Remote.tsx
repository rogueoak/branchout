'use client';

// Brambles' remote: the private controller each player acts on during a sprint. It reads the shared
// sim (whose sprint it is, the Guide) plus this device's own `state.private` secret (spec 0052):
//   - The active Guide alone sees the bloom + thorns and types clues (or skips). The engine
//     auto-referees each clue; a prick shows here and draws a new card.
//   - The Guide's teammates type guesses; the server fuzzy-matches and scores.
//   - The opposing grove waits - it is a silent audience this sprint.
// Moves are JSON `{kind, text}` sent through the generic `onMove`. It never sees another player's
// secret because the engine only ever delivers the secret to the Guide's device.

import { Badge, Button, Input } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asBramblesSim, asBramblesSecret } from './protocol';

function move(kind: 'clue' | 'guess' | 'skip', text?: string): string {
  return JSON.stringify({ kind, text });
}

export function BramblesRemote({ state, me, onMove }: GameRemoteProps) {
  const { phase, round } = state;
  const sim = asBramblesSim(state.sim);
  const secret = asBramblesSecret(state.private);
  const [draft, setDraft] = useState('');

  // Clear the draft whenever the card changes (a scored guess, a prick, or a skip advances the log).
  const logLen = sim?.log.length ?? 0;
  useEffect(() => {
    setDraft('');
  }, [logLen, sim?.sprint]);

  if (phase === 'complete' || sim?.over) {
    return <FinalResults standings={state.standings} me={me} />;
  }

  if (!sim) {
    return (
      <p className="text-body-sm text-text-muted">
        Watch the viewer - the first sprint is coming up.
      </p>
    );
  }

  // Is this device the active Guide? Only the Guide receives a secret, so `secret != null` alone
  // implies it, but check the id too for clarity.
  const isGuide = sim.guide === me;
  // Is this device on the grove that is on the clock? The sim does not carry team membership, so we
  // infer "active team" from whether this player is the Guide or was handed a guessing turn: the
  // simplest correct signal is that a non-Guide teammate can guess only when it is their grove's
  // sprint. The engine is the source of truth and rejects an out-of-turn move, so the UI offers the
  // guess box to everyone who is not the Guide and lets the engine reject an opposing-team guess.

  if (isGuide && secret) {
    const trimmed = draft.trim();
    return (
      <section aria-label="Your controller" className="flex flex-col gap-3">
        <Badge variant="primary" className="w-fit">
          You are the Guide
        </Badge>
        <div className="flex flex-col gap-1 rounded-lg bg-surface-raised p-3">
          <span className="text-caption text-text-subtle">Get your grove to say</span>
          <span className="text-h2 text-success">{secret.bloom}</span>
          <span className="text-caption text-text-subtle">Never say these thorns:</span>
          <div className="flex flex-wrap gap-1">
            {secret.thorns.map((thorn) => (
              <Badge key={thorn} variant="danger">
                {thorn}
              </Badge>
            ))}
          </div>
        </div>
        <label htmlFor="brambles-clue" className="text-body-sm font-medium text-text">
          Type a clue
        </label>
        <div className="flex gap-2">
          <Input
            id="brambles-clue"
            value={draft}
            autoComplete="off"
            placeholder="Describe it without the bloom or a thorn"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onMove(round, move('clue', trimmed));
            }}
          />
          <Button
            type="button"
            variant="primary"
            disabled={!trimmed}
            onClick={() => onMove(round, move('clue', trimmed))}
          >
            Send
          </Button>
        </div>
        {state.rejected ? (
          <Badge variant="danger" className="w-fit" role="alert">
            {state.rejected}
          </Badge>
        ) : null}
        <Button type="button" variant="outline" onClick={() => onMove(round, move('skip'))}>
          Skip this card
        </Button>
      </section>
    );
  }

  // A guesser (or an opposing-grove player). Offer a guess box; the engine rejects an out-of-turn
  // guess from the opposing grove (shown as a reject).
  const trimmed = draft.trim();
  return (
    <section aria-label="Your controller" className="flex flex-col gap-3">
      <p className="text-body text-text">
        The Guide is describing a hidden bloom. Type what you think it is.
      </p>
      <div className="flex gap-2">
        <Input
          id="brambles-guess"
          value={draft}
          autoComplete="off"
          placeholder="Your guess"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed) onMove(round, move('guess', trimmed));
          }}
        />
        <Button
          type="button"
          variant="primary"
          disabled={!trimmed}
          onClick={() => onMove(round, move('guess', trimmed))}
        >
          Guess
        </Button>
      </div>
      {state.rejected ? (
        <Badge variant="neutral" className="w-fit" role="status">
          {state.rejected}
        </Badge>
      ) : null}
    </section>
  );
}
