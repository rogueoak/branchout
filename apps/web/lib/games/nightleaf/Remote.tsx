'use client';

// Nightleaf's remote: the private controller a player acts on. It shows THIS player's own secret hand
// - delivered only to their device on the private frame (spec 0052) - and the two silent moves: play
// your lowest leaf, or propose a hush. It never shows another player's leaves, never runs a timer, and
// never tallies; it sends frames and reflects the shared grove the engine reports. Mobile-first at
// 360px. A remote-only player (no viewer pane) also sees the final results here.

import { Badge, Button } from '@rogueoak/canopy';
import type { GameRemoteProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asNightleafHand, asNightleafSim, encodeMove } from './protocol';

export function NightleafRemote({ state, me, showResults = false, onMove }: GameRemoteProps) {
  const { round } = state;
  const sim = asNightleafSim(state.sim);
  const hand = asNightleafHand(state.private);

  // No sim yet: the deal is on its way.
  if (!sim) {
    return (
      <section aria-label="Your controller" className="flex flex-col gap-2">
        <p className="text-body-sm text-text-muted">Waiting for your leaves...</p>
      </section>
    );
  }

  if (sim.over) {
    if (showResults) {
      return <FinalResults standings={state.standings} me={me} />;
    }
    const overLine = sim.won
      ? 'The grove wins - well played!'
      : 'Out of buds - see the results on the viewer.';
    return (
      <section aria-label="Your controller" className="flex flex-col gap-2">
        <p className="text-body-sm text-text-muted">{overLine}</p>
      </section>
    );
  }

  const leaves = hand?.leaves ?? [];
  const lowest = hand?.lowest ?? 0;
  const empty = leaves.length === 0;
  // Moves only land during silent play; a banner beat (tier-cleared / misplay flash) holds the grove.
  const holding = sim.phase !== 'playing';
  const proposedHush = sim.hushProposers.includes(me);
  const canHush = sim.fireflies > 0 && !empty && !proposedHush && !holding;

  let statusBadges = null;
  if (showResults) {
    statusBadges = (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">
          Tier {sim.tier} / {sim.finalTier}
        </Badge>
        <Badge variant="neutral">{sim.buds} buds</Badge>
      </div>
    );
  }

  let handList;
  if (empty) {
    handList = (
      <p className="text-body text-text-muted">
        Your hand is empty - watch the grove finish the tier.
      </p>
    );
  } else {
    handList = (
      <ol aria-label="Your hand, lowest first" className="flex flex-wrap gap-2">
        {leaves.map((leaf, i) => {
          const leafTone =
            leaf === lowest ? 'bg-secondary text-white font-medium' : 'bg-surface-raised text-text';
          return (
            <li
              key={`${leaf}-${i}`}
              className={`tabular-nums rounded-md px-3 py-2 text-body ${leafTone}`}
            >
              {leaf}
            </li>
          );
        })}
      </ol>
    );
  }

  const playLabel = empty ? 'No leaves to play' : `Play your lowest (${lowest})`;

  let hushButton = null;
  if (sim.fireflies > 0 || proposedHush) {
    const hushLabel = proposedHush ? 'Hush proposed - waiting for others' : 'Propose a hush';
    hushButton = (
      <Button
        type="button"
        variant="outline"
        disabled={!canHush}
        onClick={() => onMove(round, encodeMove({ kind: 'hush' }))}
      >
        {hushLabel}
      </Button>
    );
  }

  let footer;
  if (holding) {
    let holdingLine = 'Hold on...';
    if (sim.phase === 'misplay') {
      holdingLine = 'A leaf went out of order - the grove settles for a moment.';
    } else if (sim.phase === 'tier-cleared') {
      holdingLine = 'Tier cleared - the next leaves are on their way.';
    }
    footer = (
      <p role="status" className="text-body-sm text-text-muted">
        {holdingLine}
      </p>
    );
  } else {
    const trunkLine =
      sim.top > 0
        ? `Top of the trunk: ${sim.top}.`
        : 'The trunk is empty - the lowest leaf goes first.';
    footer = <p className="text-caption text-text-subtle">{trunkLine}</p>;
  }

  return (
    <section aria-label="Your controller" className="flex flex-col gap-4">
      {statusBadges}

      <div className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">Your leaves</h2>
        {handList}
        <p className="text-caption text-text-subtle">
          No talking about numbers. Play your lowest leaf when you think it is next.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={empty || holding}
          onClick={() => onMove(round, encodeMove({ kind: 'play' }))}
        >
          {playLabel}
        </Button>

        {hushButton}
      </div>

      {footer}
    </section>
  );
}
