import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { OddBirdViewer } from './Viewer';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState('p1'), round: 1, players, ...overrides };
}

describe('OddBirdViewer', () => {
  it('shows the public framing while the flock questions - and NO secret', () => {
    render(
      <OddBirdViewer
        state={state({
          phase: 'collecting',
          prompt: { round: 1, players: 3, category: 'everyday' },
        })}
        me="p1"
      />,
    );
    expect(screen.getByText(/question the flock/i)).toBeDefined();
    expect(screen.getByText(/3 at the roost/i)).toBeDefined();
    // The shared screen never names the roost, a perch, or the odd bird.
    expect(screen.queryByText(/coffee shop/i)).toBeNull();
  });

  it('reveals the roost, the odd bird, and the outcome at the end', () => {
    render(
      <OddBirdViewer
        state={state({
          phase: 'complete',
          reveals: [
            {
              round: 1,
              roost: 'A public library',
              oddBird: 'p2',
              flushed: 'p2',
              guessedRoost: false,
              guessedName: null,
              flockWon: true,
              accusations: { p1: 'p2', p3: 'p2' },
            },
          ],
          standings: [
            { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
            { player: 'p3', nickname: 'Cy', score: 100, rank: 1 },
            { player: 'p2', nickname: 'Bo', score: 0, rank: 3 },
          ],
        })}
        me="p1"
      />,
    );
    expect(screen.getByText(/the flock wins/i)).toBeDefined();
    expect(screen.getByText('A public library')).toBeDefined();
    // The odd bird (Bo) is named in the result panel's "The odd bird was ..." line.
    expect(screen.getByText(/the odd bird was/i).textContent).toMatch(/Bo/);
  });
});
