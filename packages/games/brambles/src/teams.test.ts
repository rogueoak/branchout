import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@branchout/protocol';
import type { SessionPlayer } from '@branchout/game-sdk';
import { activeTeamForSprint, assignTeams, guideOf, teamStandings } from './teams';

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id.toUpperCase(), connected: true }));
}

describe('assignTeams', () => {
  it('splits players by seat order (sorted id, alternating)', () => {
    const { teamOf, members } = assignTeams(players('p3', 'p1', 'p4', 'p2'));
    // sorted -> p1, p2, p3, p4 -> team 0,1,0,1
    expect(teamOf).toEqual({ p1: 0, p2: 1, p3: 0, p4: 1 });
    expect(members).toEqual([
      ['p1', 'p3'],
      ['p2', 'p4'],
    ]);
  });

  it('is deterministic - the same roster always yields the same split', () => {
    const a = assignTeams(players('p2', 'p4', 'p1', 'p3'));
    const b = assignTeams(players('p1', 'p2', 'p3', 'p4'));
    expect(a).toEqual(b);
  });

  it('the Guide is the first member of a team', () => {
    const { members } = assignTeams(players('p1', 'p2', 'p3', 'p4'));
    expect(guideOf(members[0])).toBe('p1');
    expect(guideOf(members[1])).toBe('p2');
  });
});

describe('activeTeamForSprint', () => {
  it('alternates teams each sprint', () => {
    expect(activeTeamForSprint(1)).toBe(0);
    expect(activeTeamForSprint(2)).toBe(1);
    expect(activeTeamForSprint(3)).toBe(0);
    expect(activeTeamForSprint(4)).toBe(1);
  });
});

describe('teamStandings - team result -> per-player standings', () => {
  const roster: PlayerView[] = players('p1', 'p2', 'p3', 'p4');
  const teamOf = { p1: 0, p2: 1, p3: 0, p4: 1 } as const;

  it('gives every member of the winning team the top rank', () => {
    // Team 0 (p1, p3) scores 5; team 1 (p2, p4) scores 3.
    const standings = teamStandings(roster, teamOf, [5, 3]);
    const rankOf = Object.fromEntries(standings.map((s) => [s.player, s.rank]));
    const scoreOf = Object.fromEntries(standings.map((s) => [s.player, s.score]));
    expect(rankOf.p1).toBe(1);
    expect(rankOf.p3).toBe(1);
    expect(rankOf.p2).toBe(3);
    expect(rankOf.p4).toBe(3);
    // Every member carries their TEAM's score.
    expect(scoreOf.p1).toBe(5);
    expect(scoreOf.p3).toBe(5);
    expect(scoreOf.p2).toBe(3);
  });

  it('a tie shares rank 1 across both teams', () => {
    const standings = teamStandings(roster, teamOf, [4, 4]);
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });
});
