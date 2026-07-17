// Brambles team model (spec 0061). The engine has no first-class team support (build kit item 16),
// so Brambles tracks team membership and team scores entirely in scratch and maps the team result to
// per-player `Standing[]` at the end, so every member of the winning team shares the top rank - which
// keeps the engine's individual-standings contract intact.
//
// Teams are assigned DETERMINISTICALLY by seat order at configure time: sort the players by id, then
// deal them alternately into the two groves (team 0, team 1, team 0, ...). Deterministic assignment
// means a test can pin exactly who is on which team, and a reconnect never reshuffles the teams.

import {
  rankStandings,
  type PlayerView,
  type ScoreEvent,
  type Standing,
} from '@branchout/protocol';
import type { SessionPlayer } from '@branchout/game-sdk';

/** The two groves (teams). Named for the palette: grape (violet) and sunbeam (amber). */
export const TEAM_NAMES = ['Violet grove', 'Amber grove'] as const;
export type TeamId = 0 | 1;

/** playerId -> team index, plus the ordered member lists (index 0 of each is that team's Guide). */
export interface TeamAssignment {
  teamOf: Record<string, TeamId>;
  members: [string[], string[]];
}

/**
 * Assign players to the two teams by seat order (sorted player id, alternating). Deterministic:
 * the same roster always yields the same split, so tests pin it and reconnects never reshuffle.
 */
export function assignTeams(players: readonly SessionPlayer[]): TeamAssignment {
  const ordered = [...players].map((p) => p.player).sort((a, b) => a.localeCompare(b));
  const teamOf: Record<string, TeamId> = {};
  const members: [string[], string[]] = [[], []];
  ordered.forEach((player, i) => {
    const team: TeamId = (i % 2) as TeamId;
    teamOf[player] = team;
    members[team].push(player);
  });
  return { teamOf, members };
}

/**
 * The active team for a given sprint (1-indexed round): odd sprints are the Violet grove (team 0),
 * even sprints the Amber grove (team 1), so the teams strictly alternate turns.
 */
export function activeTeamForSprint(sprint: number): TeamId {
  return ((sprint - 1) % 2) as TeamId;
}

/** The Guide for a team this game: the first member in seat order (stable across the game). */
export function guideOf(members: readonly string[]): string | undefined {
  return members[0];
}

/**
 * Map the two team scores to per-player standings. Every member of a team gets that team's total
 * as their score, so `rankStandings` gives all members of the higher-scoring team the same top rank
 * (a tie shares rank 1). This preserves the engine's individual-standings contract while scoring a
 * team game.
 */
export function teamStandings(
  players: readonly PlayerView[],
  teamOf: Record<string, TeamId>,
  teamScores: readonly [number, number],
): Standing[] {
  const scores: Record<string, number> = {};
  for (const player of players) {
    const team = teamOf[player.player];
    scores[player.player] = team === undefined ? 0 : teamScores[team];
  }
  return rankStandings(players, scores);
}

/** Build the per-player score events (each member credited the team's per-sprint blooms). */
export function teamScoreEvents(
  members: readonly string[],
  points: number,
  reason: string,
): ScoreEvent[] {
  if (points === 0) return [];
  return members.map((player) => ({ player, points, reason }));
}
