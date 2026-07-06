import type { Standing } from '@branchout/protocol';

/**
 * Platform-default stars by final rank: win 3, second 2, third 1, nothing below. Games may define
 * custom scoring later; this is the default the control-plane applies to the engine's standings.
 *
 * Standings use competition ranking (ties share a rank, the next rank skips - "1224"), so two
 * tied winners are both rank 1 and both earn 3 stars; the player after them is rank 3 and earns 1.
 */
export const STARS_BY_RANK: Readonly<Record<number, number>> = { 1: 3, 2: 2, 3: 1 };

/** A player's stars award from a completed game: their rank and the stars it converts to. */
export interface StarAward {
  player: string;
  nickname: string;
  rank: number;
  stars: number;
}

/** Stars for a single rank; zero for fourth place and below (or any non-podium rank). */
export function starsForRank(rank: number): number {
  return STARS_BY_RANK[rank] ?? 0;
}

/**
 * Convert final standings to stars awards, preserving each player's identity and rank. Ties are
 * handled by the rank the standings already carry, so tied players earn equal stars.
 */
export function standingsToStars(standings: readonly Standing[]): StarAward[] {
  return standings.map((standing) => ({
    player: standing.player,
    nickname: standing.nickname,
    rank: standing.rank,
    stars: starsForRank(standing.rank),
  }));
}
