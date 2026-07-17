import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@branchout/protocol';
import { initialGameState, type GameState } from '../../game-state';
import { SameBranchViewer } from './Viewer';

const players: PlayerView[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

const prompt = { round: 1, category: 'senses', left: 'cold', right: 'hot', reader: 'p1' };

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState('p2'), players, round: 1, ...overrides };
}

describe('SameBranchViewer', () => {
  it('shows the branch ends and the Reader while collecting - but NEVER the bud', () => {
    render(<SameBranchViewer state={state({ phase: 'collecting', prompt })} me="p2" />);
    expect(screen.getByText('cold')).toBeDefined();
    expect(screen.getByText('hot')).toBeDefined();
    expect(screen.getByText(/Reader: Ada/)).toBeDefined();
    // The bud is never rendered on the shared viewer during play.
    expect(screen.queryByText('bud')).toBeNull();
  });

  it('reveals the bud and every scored guess at leaderboard', () => {
    const reveal = {
      round: 1,
      category: 'senses',
      left: 'cold',
      right: 'hot',
      reader: 'p1',
      hunch: 'like a warm bath',
      bud: 60,
      mode: 'free',
      guesses: [
        { player: 'p2', position: 60, points: 4, band: 'bullseye' },
        { player: 'p3', position: 20, points: 0, band: 'miss' },
      ],
    };
    render(
      <SameBranchViewer
        state={state({ phase: 'leaderboard', reveals: [reveal], standings: [] })}
        me="p2"
      />,
    );
    expect(screen.getByText(/the bud/i)).toBeDefined();
    expect(screen.getByText(/like a warm bath/)).toBeDefined();
    expect(screen.getByText(/bullseye - 4 points/)).toBeDefined();
    expect(screen.getByText(/miss - 0 points/)).toBeDefined();
  });
});
