import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ZingerRemote } from './Remote';

const prompt = { round: 1, setup: 'A bad name for a boat is ___.' };
const faceOff = {
  round: 1,
  setup: prompt.setup,
  options: [
    { id: '0', text: 'The Titanic 2' },
    { id: '1', text: 'Wet Bandit' },
  ],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

describe('ZingerRemote', () => {
  it('submits a zinger', () => {
    const onMove = vi.fn();
    render(
      <ZingerRemote
        state={state({ phase: 'collecting', prompt })}
        me="p1"
        onMove={onMove}
        onVote={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/write your zinger/i), {
      target: { value: 'Wet Bandit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onMove).toHaveBeenCalledWith(1, 'Wet Bandit');
    expect(screen.getByText(/Zinger submitted/i)).toBeDefined();
  });

  it('lets a non-author vote in the face-off', () => {
    const onVote = vi.fn();
    render(
      <ZingerRemote
        state={state({ phase: 'guessing', reveals: [faceOff] })}
        me="p3"
        onMove={noop}
        onVote={onVote}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'The Titanic 2' }));
    expect(onVote).toHaveBeenCalledWith(1, '0', true);
    expect(screen.getByText(/locked in/i)).toBeDefined();
  });

  it('sits out an author whose zinger is in the face-off (hides the vote)', () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <ZingerRemote
        state={state({ phase: 'collecting', prompt })}
        me="p1"
        onMove={noop}
        onVote={onVote}
      />,
    );
    // p1 submits a zinger that then appears in the face-off.
    fireEvent.change(screen.getByLabelText(/write your zinger/i), {
      target: { value: 'The Titanic 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    rerender(
      <ZingerRemote
        state={state({ phase: 'guessing', reveals: [faceOff] })}
        me="p1"
        onMove={noop}
        onVote={onVote}
      />,
    );
    expect(screen.getByText(/sit this vote out/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'The Titanic 2' })).toBeNull();
  });
});
