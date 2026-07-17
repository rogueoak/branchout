'use client';

// Whispergrove's viewer: the shared screen everyone watches (spec 0062). It renders the live grove
// (words + revealed leaves), whose grove is up, the current whisper, the per-grove leaves-left race,
// and the end banner - all from the streamed `sim`. It NEVER shows the secret key (that rides the
// private channel to the two Whisperers only, read on their Remote). It reads state; it never drives
// the game. The opaque `sim` is decoded here at the render boundary (spec 0023).

import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asWhispergroveSim } from './protocol';
import { Grove, GroveDot, teamName } from './Grove';

export function WhispergroveViewer({ state, me }: GameViewProps) {
  const sim = asWhispergroveSim(state.sim);

  if (!sim) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-4">
        <p className="text-body text-text-muted">Preparing the grove...</p>
      </section>
    );
  }

  const over = sim.phase === 'over' && sim.winner;

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-4">
      {/* The leaves-left race for both groves. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GroveDot team="violet" />
          <span className="text-body-sm font-medium text-text">Violet {sim.violetLeft} left</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-medium text-text">Amber {sim.amberLeft} left</span>
          <GroveDot team="amber" />
        </div>
      </div>

      {over ? (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-raised p-4">
          <Badge variant="primary" className="w-fit">
            {teamName(sim.winner!)} wins
          </Badge>
          <p className="text-body-sm text-text-muted">
            {sim.endReason === 'deadwood'
              ? 'The other grove woke the Deadwood and fell.'
              : 'They linked every one of their leaves first.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-raised p-3">
          <div className="flex items-center gap-2">
            <GroveDot team={sim.turn} />
            <span className="text-body-sm font-medium text-text">
              {teamName(sim.turn)}
              {sim.phase === 'whispering' ? ' is whispering...' : ' is tapping leaves'}
            </span>
          </div>
          {sim.whisper ? (
            <p className="text-h3 text-text">
              &ldquo;{sim.whisper.word}&rdquo; - {sim.whisper.count}
              <span className="ml-2 text-body-sm text-text-muted">
                {sim.guessesLeft} {sim.guessesLeft === 1 ? 'tap' : 'taps'} left
              </span>
            </p>
          ) : (
            <p className="text-body-sm text-text-muted">
              Waiting on the Whisperer&apos;s one-word whisper.
            </p>
          )}
        </div>
      )}

      <Grove leaves={sim.leaves} />

      {over ? <FinalResults standings={state.standings} me={me} /> : null}
    </section>
  );
}
