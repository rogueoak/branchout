'use client';

// The between-round standings. Rows come straight from the engine's `leaderboard` frame (spec
// 0007), already ranked and carrying each player's nickname, so this is a pure table - no sorting
// or scoring here.

import type { Standing } from '@branchout/protocol';

interface LeaderboardProps {
  standings: Standing[];
  /** This player's id, to highlight their own row. */
  me?: string;
  title?: string;
}

export function Leaderboard({ standings, me, title = 'Leaderboard' }: LeaderboardProps) {
  if (standings.length === 0) {
    return <p className="text-body-sm text-text-muted">No scores yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h4 text-text">{title}</h3>
      <ol className="flex flex-col gap-1" aria-label={title}>
        {standings.map((standing) => {
          const isMe = me !== undefined && standing.player === me;
          return (
            <li
              key={standing.player}
              className={`flex items-center justify-between rounded-md px-3 py-2 ${
                isMe ? 'bg-surface-raised font-medium text-text' : 'text-text-muted'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-text-subtle">{standing.rank}</span>
                <span>
                  {standing.nickname}
                  {isMe ? ' (you)' : ''}
                </span>
              </span>
              <span className="tabular-nums">{standing.score}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
