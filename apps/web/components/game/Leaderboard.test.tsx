import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Standing } from '@branchout/protocol';
import { Leaderboard } from './Leaderboard';

const standings: Standing[] = [
  { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
  { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
  { player: 'p3', nickname: 'Cy', score: 0, rank: 3 },
];

describe('Leaderboard', () => {
  it('renders the ranked standings with scores and calls out the player', () => {
    render(<Leaderboard standings={standings} me="p2" />);
    const list = screen.getByRole('list', { name: 'Leaderboard' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // The player's own row is marked "(you)".
    expect(within(list).getByText(/Bo \(you\)/)).toBeDefined();
    expect(within(list).getByText('100')).toBeDefined();
  });

  it('speaks each row rank via sr-only text (medallion is decorative)', () => {
    render(<Leaderboard standings={standings} me="p2" />);
    const list = screen.getByRole('list', { name: 'Leaderboard' });
    const items = within(list).getAllByRole('listitem');
    // A screen reader reads the rank from the row, not just the name + score.
    expect(items[0].textContent).toContain('Rank 1,');
    expect(items[1].textContent).toContain('Rank 2,');
  });

  it('shows the auto-advance countdown when a dwell is supplied', () => {
    render(<Leaderboard standings={standings} me="p1" autoAdvanceSecondsLeft={3} />);
    expect(screen.getByText('Next round in 3 seconds')).toBeDefined();
  });

  it('omits the countdown when auto-advance is off (null/undefined)', () => {
    render(<Leaderboard standings={standings} me="p1" autoAdvanceSecondsLeft={null} />);
    expect(screen.queryByText(/Next round in/)).toBeNull();
  });

  it('renders an empty-state message with no standings', () => {
    render(<Leaderboard standings={[]} />);
    expect(screen.getByText(/No scores yet/)).toBeDefined();
  });
});
