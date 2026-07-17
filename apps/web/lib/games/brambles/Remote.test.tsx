import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { BramblesRemote } from './Remote';

const sim = {
  over: false,
  sprint: 1,
  totalSprints: 6,
  activeTeam: 0,
  guide: 'p1',
  teamScores: [0, 0],
  bloomsThisSprint: 0,
  pricksThisSprint: 0,
  secondsLeft: 60,
  log: [],
};

const secret = { bloom: 'mountain', thorns: ['peak', 'climb', 'summit', 'high', 'range'] };

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), phase: 'collecting', round: 1, sim, ...overrides };
}

function noop() {}

describe('BramblesRemote - the Guide', () => {
  it('shows the bloom + thorns and sends a clue', () => {
    const onMove = vi.fn();
    render(
      <BramblesRemote state={state({ private: secret })} me="p1" onMove={onMove} onVote={noop} />,
    );
    expect(screen.getByText('You are the Guide')).toBeDefined();
    // The Guide's OWN device shows the secret.
    expect(screen.getByText('mountain')).toBeDefined();
    expect(screen.getByText('peak')).toBeDefined();

    fireEvent.change(screen.getByLabelText(/type a clue/i), { target: { value: 'it is tall' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ kind: 'clue', text: 'it is tall' }));
  });

  it('sends a skip', () => {
    const onMove = vi.fn();
    render(
      <BramblesRemote state={state({ private: secret })} me="p1" onMove={onMove} onVote={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /skip this card/i }));
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ kind: 'skip' }));
  });
});

describe('BramblesRemote - a guesser', () => {
  it('has NO secret and cannot see the bloom or thorns; it sends a guess', () => {
    const onMove = vi.fn();
    // A guessing teammate has `state.private === null` (the engine never delivered them the secret).
    render(
      <BramblesRemote state={state({ private: null })} me="p3" onMove={onMove} onVote={noop} />,
    );
    // The guesser never sees the secret words.
    expect(screen.queryByText('mountain')).toBeNull();
    expect(screen.queryByText('peak')).toBeNull();
    expect(screen.queryByText('You are the Guide')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/your guess/i), { target: { value: 'mountain' } });
    fireEvent.click(screen.getByRole('button', { name: /guess/i }));
    expect(onMove).toHaveBeenCalledWith(1, JSON.stringify({ kind: 'guess', text: 'mountain' }));
  });
});
