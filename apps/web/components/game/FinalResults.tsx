'use client';

// The final results screen: the same ranked standings, plus the stars each placing earns. Stars
// are the platform default (win 3, second 2, third 1) mirrored from the control-plane for display
// only - the control-plane is the authority that records them (spec 0006).

import type { Standing } from '@branchout/protocol';
import { Badge } from '@rogueoak/canopy';
import { starsForRank } from '../../lib/game-state';

interface FinalResultsProps {
  standings: Standing[];
  me?: string;
}

/** A single filled star, drawn as an SVG so it renders crisply and identically across platforms. */
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-5">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/** A row of stars for a placing, labelled for screen readers. */
function Stars({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-caption text-text-subtle">No stars</span>;
  }
  return (
    <span
      aria-label={`${count} star${count === 1 ? '' : 's'}`}
      className="flex items-center gap-0.5 text-warning"
    >
      {Array.from({ length: count }, (_, index) => (
        <StarIcon key={index} />
      ))}
    </span>
  );
}

export function FinalResults({ standings, me }: FinalResultsProps) {
  const winner = standings.find((standing) => standing.rank === 1);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Badge variant="primary" className="w-fit">
          Final results
        </Badge>
        {winner ? (
          <h2 className="text-h2 text-text">
            {winner.player === me ? 'You win!' : `${winner.nickname} wins!`}
          </h2>
        ) : (
          <h2 className="text-h2 text-text">Game over</h2>
        )}
      </div>

      <ol className="flex flex-col gap-2" aria-label="Final standings">
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
              <span className="flex items-center gap-3">
                <Stars count={starsForRank(standing.rank)} />
                <span className="tabular-nums">{standing.score}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
