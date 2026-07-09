import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { LiarLiarRemote } from './Remote';

const prompt = { round: 1, clue: 'A festival throws ___ at people.', category: 'events' };
const optionsReveal = {
  round: 1,
  clue: prompt.clue,
  options: [
    { id: '0', text: 'tomatoes' },
    { id: '1', text: 'buttons' },
    { id: '2', text: 'oranges' },
  ],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

describe('LiarLiarRemote', () => {
  it('submits a lie', () => {
    const onAnswer = vi.fn();
    render(
      <LiarLiarRemote
        state={state({ phase: 'collecting', prompt })}
        me="p1"
        onAnswer={onAnswer}
        onVote={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/write your lie/i), { target: { value: 'buttons' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onAnswer).toHaveBeenCalledWith(1, 'buttons');
    expect(screen.getByText(/Lie submitted/i)).toBeDefined();
  });

  it('shows the vague rejection and lets the player retype', () => {
    const onAnswer = vi.fn();
    const { rerender } = render(
      <LiarLiarRemote
        state={state({ phase: 'collecting', prompt })}
        me="p1"
        onAnswer={onAnswer}
        onVote={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/write your lie/i), { target: { value: 'buttons' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    // The engine rejects it (a duplicate or the truth); the reducer records the reason.
    rerender(
      <LiarLiarRemote
        state={state({ phase: 'collecting', prompt, rejected: 'someone already submitted that' })}
        me="p1"
        onAnswer={onAnswer}
        onVote={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/someone already submitted that/i);
    // Editing the draft dismisses the rejection so a retype reads clean.
    fireEvent.change(screen.getByLabelText(/write your lie/i), { target: { value: 'radishes' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers the options to guess and hides the player own lie', () => {
    const onVote = vi.fn();
    // First submit "buttons" while collecting so the remote knows this player's lie.
    const { rerender } = render(
      <LiarLiarRemote
        state={state({ phase: 'collecting', prompt })}
        me="p1"
        onAnswer={noop}
        onVote={onVote}
      />,
    );
    fireEvent.change(screen.getByLabelText(/write your lie/i), { target: { value: 'buttons' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    // Now guessing: every option is a button except the player's own lie ("buttons").
    rerender(
      <LiarLiarRemote
        state={state({ phase: 'guessing', prompt, reveals: [optionsReveal] })}
        me="p1"
        onAnswer={noop}
        onVote={onVote}
      />,
    );
    expect(screen.getByRole('button', { name: 'tomatoes' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'oranges' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'buttons' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'tomatoes' }));
    expect(onVote).toHaveBeenCalledWith(1, '0', true);
    expect(screen.getByText(/Locked in/i)).toBeDefined();
  });
});
