'use client';

// Brambles' viewer: the shared screen everyone watches. It shows the two groves' scores, whose grove
// is on the clock this sprint (and who their Guide is), the seconds left, and the running public log
// of clues, correct guesses, pricks, and skips. It NEVER shows the bloom or thorns - that secret goes
// only to the active Guide's own remote (spec 0052). It reads state; it never drives the game.

import { Badge } from '@rogueoak/canopy';
import type { PlayerView } from '@branchout/protocol';
import type { GameViewProps } from '../registry';
import { FinalResults } from '../../../components/game/FinalResults';
import { asBramblesSim, type BramblesLogEntry } from './protocol';

const TEAM_NAMES = ['Violet grove', 'Amber grove'] as const;

function nicknameOf(players: PlayerView[], id: string): string {
  return players.find((p) => p.player === id)?.nickname ?? id;
}

function logLine(entry: BramblesLogEntry, players: PlayerView[]): string {
  const who = nicknameOf(players, entry.player);
  switch (entry.kind) {
    case 'clue':
      return `${who}: "${entry.text}"`;
    case 'guess':
      return `${who} guessed "${entry.text}" - a bloom!`;
    case 'prick':
      return `A thorn was touched - the card wilts.`;
    case 'skip':
      return `${who} skipped the card.`;
  }
}

export function BramblesViewer({ state, me }: GameViewProps) {
  const { phase, standings, players } = state;
  const sim = asBramblesSim(state.sim);

  if (phase === 'complete' || sim?.over) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-5">
        <FinalResults standings={standings} me={me} />
      </section>
    );
  }

  if (!sim) {
    return (
      <section aria-label="Game viewer" className="flex flex-col gap-2">
        <h2 className="text-h3 text-text">Get ready</h2>
        <p className="text-body text-text-muted">The first sprint is on its way.</p>
      </section>
    );
  }

  const guideName = nicknameOf(players, sim.guide);
  const timerVariant = sim.secondsLeft <= 10 ? 'warning' : 'neutral';

  let logItems;
  if (sim.log.length === 0) {
    logItems = <li className="text-body-sm text-text-subtle">Waiting for the first clue...</li>;
  } else {
    logItems = sim.log.map((entry, i) => {
      let toneClass = 'text-text';
      if (entry.kind === 'guess') toneClass = 'text-success';
      else if (entry.kind === 'prick') toneClass = 'text-danger';
      return (
        <li key={i} className={`text-body-sm ${toneClass}`}>
          {logLine(entry, players)}
        </li>
      );
    });
  }

  return (
    <section aria-label="Game viewer" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">
          Sprint {sim.sprint} of {sim.totalSprints}
        </Badge>
        <Badge variant={timerVariant}>
          <span role="timer" aria-label={`${sim.secondsLeft} seconds left`}>
            {sim.secondsLeft}s left
          </span>
        </Badge>
      </div>

      {/* Scoreboard: the two groves. The active one this sprint is highlighted. */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((team) => {
          const active = sim.activeTeam === team;
          const cardClass = active ? 'bg-surface-raised ring-2 ring-primary' : 'bg-surface-raised';
          const status = active ? (
            <span className="text-caption text-primary">On the clock - Guide: {guideName}</span>
          ) : (
            <span className="text-caption text-text-subtle">Watching</span>
          );
          return (
            <div key={team} className={`flex flex-col gap-1 rounded-lg p-3 ${cardClass}`}>
              <span className="text-body-sm font-medium text-text">{TEAM_NAMES[team]}</span>
              <span className="text-h2 tabular-nums text-text">{sim.teamScores[team]}</span>
              {status}
            </div>
          );
        })}
      </div>

      <p className="text-body text-text-muted">
        {guideName} is describing a hidden bloom. Their grove is typing guesses - most blooms wins.
      </p>

      {/* The running public log - clues + correct guesses + pricks. Never the secret bloom/thorns. */}
      <div className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-text">This sprint</span>
        <ul aria-label="Sprint log" className="flex flex-col gap-1">
          {logItems}
        </ul>
      </div>
    </section>
  );
}
