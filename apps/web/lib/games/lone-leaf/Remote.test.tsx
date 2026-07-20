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
const resultReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  seed: 'river',
  guess: 'river',
  correct: true,
  survivors: ['flow'],
  leaves: [{ player: 'p2', word: 'flow', survived: true }],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

describe('LoneLeafRemote', () => {
  it('a non-Seeker sees the hidden word and submits a one-word clue', () => {
    const onMove = vi.fn();
    render(
      <LoneLeafRemote
        // p2 is NOT the Seeker, so their device has the private word.
        state={state({ phase: 'collecting', prompt, private: secret })}
        me="p2"
        onMove={onMove}
        onVote={noop}
      />,
    );
    // A non-Seeker sees the hidden word they are cluing, labelled in plain terms.
    expect(screen.getByText('river')).toBeDefined();
    expect(screen.getByText(/only you and your group see it/i)).toBeDefined();
    fireEvent.change(screen.getByLabelText(/write your clue/i), { target: { value: 'flow' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onMove).toHaveBeenCalledWith(1, 'flow');
    expect(screen.getByText(/Clue sent/i)).toBeDefined();
  });

  it('the SEEKER never sees the word and cannot write a clue', () => {
    render(
      <LoneLeafRemote
        // p1 IS the Seeker: the engine sent them NO private frame, so state.private is null.
        state={state({ phase: 'collecting', prompt, private: null })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    // The word never appears on the Seeker's device.
    expect(screen.queryByText(/river/i)).toBeNull();
    // The Seeker has no clue input - they only wait.
    expect(screen.queryByLabelText(/write your clue/i)).toBeNull();
    expect(screen.getByText(/You are the Seeker/i)).toBeDefined();
  });

  it('the Seeker guesses from the remaining clues', () => {
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
    fireEvent.change(screen.getByLabelText(/your guess/i), { target: { value: 'river' } });
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
    expect(screen.queryByLabelText(/your guess/i)).toBeNull();
  });

  it('a remote-only player sees the prompt card and countdown while collecting', () => {
    render(
      <LoneLeafRemote
        state={state({
          phase: 'collecting',
          prompt,
          private: secret,
          moveMsRemaining: 20_000,
          moveWindowMs: 30_000,
        })}
        me="p2"
        showResults
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByTestId('lone-leaf-prompt')).toBeDefined();
    expect(screen.getByRole('timer')).toBeDefined();
  });

  it('a remote-only Seeker sees the countdown while guessing (the guess phase is timed)', () => {
    render(
      <LoneLeafRemote
        state={state({
          phase: 'guessing',
          prompt,
          reveals: [survivorsReveal],
          moveMsRemaining: 40_000,
          moveWindowMs: 60_000,
        })}
        me="p1"
        showResults
        onMove={noop}
        onVote={noop}
      />,
    );
    // The remote-only Seeker is the sole actor during a timed guess, so they must see the timer.
    expect(screen.getByTestId('countdown-card')).toBeDefined();
    expect(screen.getByRole('timer')).toBeDefined();
    // ...and can still make the guess.
    expect(screen.getByLabelText(/your guess/i)).toBeDefined();
  });

  it('a remote-only player sees the result reveal after the round', () => {
    render(
      <LoneLeafRemote
        state={state({
          phase: 'leaderboard',
          prompt,
          reveals: [resultReveal],
          standings: [{ player: 'p2', nickname: 'Bo', rank: 1, score: 1 }],
        })}
        me="p2"
        showResults
        onMove={noop}
        onVote={noop}
      />,
    );
    // The remote sees the same reveal the viewer shows: the hidden word as the focus.
    expect(screen.getByTestId('reveal-word').textContent).toBe('river');
    expect(screen.getByText(/your group guessed it/i)).toBeDefined();
  });
});
