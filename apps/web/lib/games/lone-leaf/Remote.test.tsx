import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { LoneLeafRemote } from './Remote';

const prompt = { round: 1, category: 'nature', seeker: 'p1' };
const secret = { round: 1, seed: 'river', category: 'nature' };
const survivorsReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  survivors: ['flow', 'blue'],
  leaves: [{ player: 'p2', word: 'flow', survived: true }],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

describe('LoneLeafRemote', () => {
  it('a non-Seeker sees the seed and submits a one-word leaf', () => {
    const onMove = vi.fn();
    render(
      <LoneLeafRemote
        // p2 is NOT the Seeker, so their device has the private seed.
        state={state({ phase: 'collecting', prompt, private: secret })}
        me="p2"
        onMove={onMove}
        onVote={noop}
      />,
    );
    // A non-Seeker sees the seed they are cluing.
    expect(screen.getByText('river')).toBeDefined();
    fireEvent.change(screen.getByLabelText(/write one leaf/i), { target: { value: 'flow' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onMove).toHaveBeenCalledWith(1, 'flow');
    expect(screen.getByText(/Leaf sent/i)).toBeDefined();
  });

  it('the SEEKER never sees the seed and cannot write a leaf', () => {
    render(
      <LoneLeafRemote
        // p1 IS the Seeker: the engine sent them NO private frame, so state.private is null.
        state={state({ phase: 'collecting', prompt, private: null })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    // The seed word never appears on the Seeker's device.
    expect(screen.queryByText(/river/i)).toBeNull();
    // The Seeker has no leaf input - they only wait.
    expect(screen.queryByLabelText(/write one leaf/i)).toBeNull();
    expect(screen.getByText(/You are the Seeker/i)).toBeDefined();
  });

  it('the Seeker guesses from the surviving leaves', () => {
    const onVote = vi.fn();
    render(
      <LoneLeafRemote
        state={state({ phase: 'guessing', prompt, reveals: [survivorsReveal] })}
        me="p1"
        onMove={noop}
        onVote={onVote}
      />,
    );
    expect(screen.getByText('flow')).toBeDefined();
    fireEvent.change(screen.getByLabelText(/your one guess/i), { target: { value: 'river' } });
    fireEvent.click(screen.getByRole('button', { name: /guess/i }));
    expect(onVote).toHaveBeenCalledWith(1, 'river', true);
    expect(screen.getByText(/Guess locked in/i)).toBeDefined();
  });

  it('a non-Seeker waits during the guess phase', () => {
    render(
      <LoneLeafRemote
        state={state({ phase: 'guessing', prompt, reveals: [survivorsReveal] })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByText(/The Seeker is making the guess/i)).toBeDefined();
    expect(screen.queryByLabelText(/your one guess/i)).toBeNull();
  });
});
