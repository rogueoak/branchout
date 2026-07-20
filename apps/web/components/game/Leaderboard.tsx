'use client';

// The between-round standings (spec 0007), given a glow-up in spec 0069: a podium feel with the top
// three emphasized, medallion ranks, and the player's own row called out. Rows come straight from
// the engine's `leaderboard` frame, already ranked and carrying each nickname, so this stays a pure
// view - no sorting or scoring here. `autoAdvanceSecondsLeft` is optional so every other game that
// renders this component is unaffected; Trivia passes it to show the auto-advance dwell.

import type { Standing } from '@branchout/protocol';

interface LeaderboardProps {
  standings: Standing[];
  /** This player's id, to highlight their own row. */
  me?: string;
  title?: string;
  /**
   * Whole seconds until the engine auto-advances to the next round, or null/undefined when the host
   * advances manually (auto-advance off). When set, a "Next round in x" line shows below the list.
   */
  autoAdvanceSecondsLeft?: number | null;
}

/** Medallion tone for a rank: gold / silver / bronze for the podium, muted for the rest. */
const RANK_CLASS: Record<number, string> = {
  1: 'bg-warning/20 text-warning ring-1 ring-warning/40',
  2: 'bg-surface-raised text-text ring-1 ring-border-strong',
  3: 'bg-primary/15 text-primary ring-1 ring-primary/30',
};

export function Leaderboard({
  standings,
  me,
  title = 'Leaderboard',
  autoAdvanceSecondsLeft,
}: LeaderboardProps) {
  if (standings.length === 0) {
    return <p className="text-body-sm text-text-muted">No scores yet.</p>;
  }

  let countdown = null;
  if (autoAdvanceSecondsLeft !== null && autoAdvanceSecondsLeft !== undefined) {
    countdown = (
      <p className="text-center text-body-sm text-text-muted" role="status" aria-live="polite">
        Next round in {autoAdvanceSecondsLeft} {autoAdvanceSecondsLeft === 1 ? 'second' : 'seconds'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h4 text-text">{title}</h3>
      <ol className="flex flex-col gap-2" aria-label={title}>
        {standings.map((standing) => {
          const isMe = me !== undefined && standing.player === me;
          const rankClass = RANK_CLASS[standing.rank] ?? 'bg-surface-raised text-text-subtle';
          const isPodium = standing.rank <= 3;
          const rowClass = isMe
            ? 'bg-surface-raised font-semibold text-text ring-1 ring-primary/40'
            : isPodium
              ? 'bg-surface-raised/60 text-text'
              : 'text-text-muted';
          return (
            <li
              key={standing.player}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${rowClass}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold tabular-nums ${rankClass}`}
                >
                  {standing.rank}
                </span>
                <span className="truncate">
                  {standing.nickname}
                  {isMe ? ' (you)' : ''}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-text">{standing.score}</span>
            </li>
          );
        })}
      </ol>
      {countdown}
    </div>
  );
}
