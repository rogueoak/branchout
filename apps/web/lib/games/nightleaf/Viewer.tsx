'use client';

// Nightleaf's viewer: the shared grove everyone watches. It renders the SHARED state from the sim
// frame - the trunk (leaves played in ascending order), the buds (lives), the tier, the fireflies, and
// each player's leaf COUNT (never their leaf values, which are secret) - plus the banner beats
// (tier-cleared, misplay flash, win/loss). It reads state; it never drives the game. The player's own
// hand and the play controls live on their Remote. Mobile-first: one stacked column at 360px.

import { Badge } from '@rogueoak/canopy';
import type { GameViewProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asNightleafSim, type NightleafSim } from './protocol';

/** A row of filled/empty pips for a small resource track (buds, fireflies). */
function Pips({ filled, total, label }: { filled: number; total: number; label: string }) {
  const pips = Array.from({ length: Math.max(total, filled) }, (_, i) => i < filled);
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${filled} of ${total} ${label}`}>
      {pips.map((on, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`inline-block h-3 w-3 rounded-full ${on ? 'bg-secondary' : 'bg-surface-raised'}`}
        />
      ))}
    </span>
  );
}

/** One line of aria-live status text summarizing the shared grove for screen readers + the e2e. */
function statusText(sim: NightleafSim): string {
  if (sim.phase === 'won') return 'You cleared the final tier - the grove wins!';
  if (sim.phase === 'lost') return 'Out of buds - the grove falls. Try again.';
  const climb = `Tier ${sim.tier} of ${sim.finalTier}`;
  const buds = `${sim.buds} of ${sim.maxBuds} buds left`;
  const trunk = sim.top > 0 ? `top leaf ${sim.top}` : 'trunk empty';
  const left = `${sim.leavesLeft} leaves still held`;
  if (sim.phase === 'misplay' && sim.lastMisplay) {
    return `Out of order! ${sim.lastMisplay.played} played while ${sim.lastMisplay.lowestHeld} was still held - lost a bud. ${buds}.`;
  }
  if (sim.phase === 'tier-cleared') return `Tier ${sim.tier} cleared! ${buds}.`;
  return `${climb}, ${buds}, ${trunk}, ${left}.`;
}

export function NightleafViewer({ state, me }: GameViewProps) {
  const sim = asNightleafSim(state.sim);

  if (!sim) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">The grove is waking</h2>
        <p className="text-body text-text-muted">Leaves are being dealt - hold quiet.</p>
      </section>
    );
  }

  if (sim.over) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <div className="rounded-lg bg-surface-raised p-4" role="status">
          <h2 className={`text-h2 ${sim.won ? 'text-success' : 'text-danger'}`}>
            {sim.won ? 'The grove wins!' : 'The grove falls'}
          </h2>
          <p className="text-body text-text-muted">
            {sim.won
              ? `You cleared all ${sim.finalTier} tiers in silence.`
              : 'The buds ran out. Regroup and climb again.'}
          </p>
        </div>
        <FinalResults standings={state.standings} me={me} />
        <p role="status" className="sr-only">
          {statusText(sim)}
        </p>
      </section>
    );
  }

  const banner =
    sim.phase === 'misplay' && sim.lastMisplay ? (
      <Badge variant="danger" role="status">
        Out of order - {sim.lastMisplay.played} beat {sim.lastMisplay.lowestHeld}. Lost a bud.
      </Badge>
    ) : sim.phase === 'tier-cleared' ? (
      <Badge variant="success" role="status">
        Tier {sim.tier} cleared!
      </Badge>
    ) : null;

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">
          Tier {sim.tier} / {sim.finalTier}
        </Badge>
        <span className="inline-flex items-center gap-1 text-body-sm text-text">
          Buds <Pips filled={sim.buds} total={sim.maxBuds} label="buds" />
        </span>
        <span className="inline-flex items-center gap-1 text-body-sm text-text">
          Fireflies{' '}
          <span aria-label={`${sim.fireflies} fireflies left`} className="tabular-nums">
            {sim.fireflies}
          </span>
        </span>
      </div>

      {banner}

      <div className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">The trunk</h2>
        {sim.trunk.length === 0 ? (
          <p className="text-body text-text-muted">No leaves played yet. Lowest goes first.</p>
        ) : (
          <ol aria-label="Leaves played on the trunk, ascending" className="flex flex-wrap gap-2">
            {sim.trunk.map((leaf, i) => (
              <li
                key={`${leaf}-${i}`}
                className={`tabular-nums rounded-md px-3 py-1.5 text-body ${
                  i === sim.trunk.length - 1
                    ? 'bg-secondary text-white'
                    : 'bg-surface-raised text-text'
                }`}
              >
                {leaf}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">The grove</h2>
        <ul aria-label="Players and their remaining leaf counts" className="flex flex-col gap-1">
          {sim.hands.map((hand) => (
            <li key={hand.player} className="flex items-center justify-between text-body">
              <span className="text-text">
                {hand.nickname}
                {hand.player === me ? ' (you)' : ''}
                {sim.hushProposers.includes(hand.player) ? ' - proposed a hush' : ''}
              </span>
              <span className="tabular-nums text-text-muted">
                {hand.count} {hand.count === 1 ? 'leaf' : 'leaves'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p role="status" className="sr-only">
        {statusText(sim)}
      </p>
    </section>
  );
}
