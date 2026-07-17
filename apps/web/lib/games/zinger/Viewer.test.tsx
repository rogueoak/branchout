import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ZingerViewer } from './Viewer';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Ben', connected: true },
];

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, players, ...overrides };
}

describe('ZingerViewer', () => {
  it('shows the setup while collecting', () => {
    render(
      <ZingerViewer
        state={state({ phase: 'collecting', prompt: { round: 1, setup: 'A bad boat name: ___.' } })}
        me="p1"
      />,
    );
    expect(screen.getByText('A bad boat name: ___.')).toBeDefined();
    expect(screen.getByText(/writing a zinger/i)).toBeDefined();
  });

  it('shows the two zingers during the face-off', () => {
    render(
      <ZingerViewer
        state={state({
          phase: 'guessing',
          reveals: [
            {
              round: 1,
              setup: 'A bad boat name: ___.',
              options: [
                { id: '0', text: 'The Titanic 2' },
                { id: '1', text: 'Wet Bandit' },
              ],
            },
          ],
        })}
        me="p1"
      />,
    );
    expect(screen.getByText('The Titanic 2')).toBeDefined();
    expect(screen.getByText('Wet Bandit')).toBeDefined();
    expect(screen.getByText(/vote on your phone/i)).toBeDefined();
  });

  it('shows the result with the winner, authors, tallies, and a clean sweep', () => {
    render(
      <ZingerViewer
        state={state({
          phase: 'leaderboard',
          reveals: [
            {
              round: 1,
              setup: 'A bad boat name: ___.',
              options: [
                { id: '0', text: 'The Titanic 2', author: 'p1', votes: 2, winner: true },
                { id: '1', text: 'Wet Bandit', author: 'p2', votes: 0, winner: false },
              ],
              winner: '0',
              cleanSweep: true,
            },
          ],
        })}
        me="p2"
      />,
    );
    expect(screen.getByText(/clean sweep/i)).toBeDefined();
    expect(screen.getByText(/The Titanic 2/)).toBeDefined();
    expect(screen.getByText(/by Ada/)).toBeDefined();
    // p2 (me) authored the losing zinger, labeled as "Your zinger".
    expect(screen.getByText(/Your zinger/i)).toBeDefined();
  });
});
