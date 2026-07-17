import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { BramblesViewer } from './Viewer';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
  { player: 'p4', nickname: 'Di', connected: true },
];

const sim = {
  over: false,
  sprint: 1,
  totalSprints: 6,
  activeTeam: 0,
  guide: 'p1',
  teamScores: [1, 0],
  bloomsThisSprint: 1,
  pricksThisSprint: 0,
  secondsLeft: 42,
  log: [
    { kind: 'clue', text: 'it is very tall', player: 'p1' },
    { kind: 'guess', text: 'mountain', player: 'p3' },
  ],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), phase: 'collecting', players, ...overrides };
}

describe('BramblesViewer', () => {
  it('shows the scoreboard, the active grove, the Guide, and the timer', () => {
    render(<BramblesViewer state={state({ sim })} me="p3" />);
    expect(screen.getByText(/Sprint 1 of 6/i)).toBeDefined();
    expect(screen.getByText('Violet grove')).toBeDefined();
    expect(screen.getByText('Amber grove')).toBeDefined();
    expect(screen.getByText(/Guide: Ada/i)).toBeDefined();
    expect(screen.getByRole('timer')).toBeDefined();
    // The public log renders the clue text and the scored guess.
    expect(screen.getByText(/it is very tall/i)).toBeDefined();
  });

  it('NEVER shows the bloom or thorns - they are not in the sim frame at all', () => {
    // The viewer only reads `state.sim`, which carries no secret. Even if a (bogus) private payload
    // is on state, the viewer must not render it.
    render(
      <BramblesViewer
        state={state({ sim, private: { bloom: 'SECRETBLOOM', thorns: ['SECRETTHORN'] } })}
        me="p2"
      />,
    );
    expect(screen.queryByText(/SECRETBLOOM/)).toBeNull();
    expect(screen.queryByText(/SECRETTHORN/)).toBeNull();
  });
});
