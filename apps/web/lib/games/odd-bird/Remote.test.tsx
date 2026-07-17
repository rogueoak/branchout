import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { OddBirdRemote } from './Remote';
import { ROOST_GUESS_TARGET_PREFIX } from './index';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

const flushReveal = {
  round: 1,
  players: ['p1', 'p2', 'p3'],
  roostOptions: [
    { id: 'everyday-001', name: 'A coffee shop' },
    { id: 'everyday-002', name: 'A library' },
  ],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState('p1'), round: 1, players, ...overrides };
}

function noop() {}

describe('OddBirdRemote', () => {
  it('shows a flock member their roost and perch, and lets them call the flush', () => {
    const onMove = vi.fn();
    render(
      <OddBirdRemote
        state={state({
          phase: 'collecting',
          private: { role: 'flock', roost: 'A busy coffee shop', perch: 'Barista' },
        })}
        me="p1"
        onMove={onMove}
        onVote={noop}
      />,
    );
    expect(screen.getByText('A busy coffee shop')).toBeDefined();
    expect(screen.getByText('Barista')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /call the flush/i }));
    expect(onMove).toHaveBeenCalledWith(1, 'flush');
  });

  it('tells the odd bird they are the odd bird and shows NO roost', () => {
    render(
      <OddBirdRemote
        state={state({ phase: 'collecting', private: { role: 'odd-bird' } })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByText(/you are the odd bird/i)).toBeDefined();
    // The odd bird's card names no roost.
    expect(screen.queryByText(/coffee shop/i)).toBeNull();
  });

  it('a flock member accuses a player (never themselves)', () => {
    const onVote = vi.fn();
    render(
      <OddBirdRemote
        state={state({
          phase: 'guessing',
          reveals: [flushReveal],
          private: { role: 'flock', roost: 'A library', perch: 'Librarian' },
        })}
        me="p1"
        onMove={noop}
        onVote={onVote}
      />,
    );
    // p1 cannot accuse themselves; Bo and Cy are offered.
    expect(screen.queryByRole('button', { name: 'Ada' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bo' }));
    expect(onVote).toHaveBeenCalledWith(1, 'p2', true);
    expect(screen.getByText(/accusation locked in/i)).toBeDefined();
  });

  it('the odd bird guesses a roost from the slate (prefixed vote target)', () => {
    const onVote = vi.fn();
    render(
      <OddBirdRemote
        state={state({
          phase: 'guessing',
          reveals: [flushReveal],
          private: { role: 'odd-bird' },
        })}
        me="p1"
        onMove={noop}
        onVote={onVote}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'A library' }));
    expect(onVote).toHaveBeenCalledWith(1, `${ROOST_GUESS_TARGET_PREFIX}everyday-002`, true);
    expect(screen.getByText(/guess locked in/i)).toBeDefined();
  });
});
