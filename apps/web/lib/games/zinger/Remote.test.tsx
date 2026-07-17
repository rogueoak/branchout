import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ZingerRemote } from './Remote';

const prompt = { round: 1, setup: 'A bad name for a boat is ___.' };
// The face-off names its two contestant authors (p1, p2) so a remote gates its sit-out on identity,
// not on text.
const faceOff = {
  round: 1,
  setup: prompt.setup,
  options: [
    { id: '0', text: 'The Titanic 2' },
    { id: '1', text: 'Wet Bandit' },
  ],
  authorIds: ['p1', 'p2'],
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

  it('sits out a contestant author by identity (author id in the face-off)', () => {
    const onVote = vi.fn();
    render(
      <ZingerRemote
        state={state({ phase: 'guessing', reveals: [faceOff] })}
        me="p1" // one of the two contestant authorIds
        onMove={noop}
        onVote={onVote}
      />,
    );
    expect(screen.getByText(/sit this vote out/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'The Titanic 2' })).toBeNull();
  });

  it('does NOT disenfranchise a non-author who typed identical text to a face-off option', () => {
    // p3 is NOT a contestant author, but happened to submit the same short answer ("Wet Bandit") as
    // one of the two face-off zingers. The old text-match gate would sit them out; the identity gate
    // must still show them the vote buttons.
    const onVote = vi.fn();
    const { rerender } = render(
      <ZingerRemote
        state={state({ phase: 'collecting', prompt })}
        me="p3"
        onMove={noop}
        onVote={onVote}
      />,
    );
    fireEvent.change(screen.getByLabelText(/write your zinger/i), {
      target: { value: 'Wet Bandit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    rerender(
      <ZingerRemote
        state={state({ phase: 'guessing', reveals: [faceOff] })}
        me="p3" // not in authorIds -> a real voter
        onMove={onVote}
        onVote={onVote}
      />,
    );
    expect(screen.queryByText(/sit this vote out/i)).toBeNull();
    // Both options remain votable - including the one whose text matches p3's own answer.
    fireEvent.click(screen.getByRole('button', { name: 'Wet Bandit' }));
    expect(onVote).toHaveBeenCalledWith(1, '1', true);
  });
});
