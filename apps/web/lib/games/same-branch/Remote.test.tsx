import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { SameBranchRemote } from './Remote';

const prompt = { round: 1, category: 'senses', left: 'cold', right: 'hot', reader: 'p1' };
const secret = { round: 1, bud: 62, left: 'cold', right: 'hot' };

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState('p2'), round: 1, ...overrides };
}

function noop() {}

describe('SameBranchRemote', () => {
  it('the Reader sees the bud (from the private secret) and sends a hunch', () => {
    const onMove = vi.fn();
    render(
      <SameBranchRemote
        state={{
          ...initialGameState('p1'),
          round: 1,
          phase: 'collecting',
          prompt,
          private: secret,
        }}
        me="p1"
        onMove={onMove}
        onVote={noop}
      />,
    );
    expect(screen.getByText(/you are the reader/i)).toBeDefined();
    // The Reader's dial shows the bud marker.
    expect(screen.getByText('the bud')).toBeDefined();
    fireEvent.change(screen.getByLabelText(/your hunch/i), {
      target: { value: 'like a warm bath' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(onMove).toHaveBeenCalledWith(1, 'like a warm bath');
  });

  it('a NON-Reader guesser never receives the bud and locks in a sap-line position', () => {
    const onMove = vi.fn();
    render(
      <SameBranchRemote
        // A non-Reader's private is null - the engine never delivered them the bud.
        state={state({ phase: 'collecting', prompt, private: null })}
        me="p2"
        onMove={onMove}
        onVote={noop}
      />,
    );
    // No bud marker anywhere on a guesser's controller.
    expect(screen.queryByText('the bud')).toBeNull();
    expect(screen.getByText(/move the sap line/i)).toBeDefined();

    // Lock-in is disabled until the sap line is moved.
    const lock = screen.getByRole('button', { name: /lock in my guess/i });
    expect(lock.hasAttribute('disabled')).toBe(true);
    const slider = screen.getByRole('slider', { name: /move the sap line/i });
    fireEvent.keyDown(slider, { key: 'End' }); // -> 100
    fireEvent.click(screen.getByRole('button', { name: /lock in my guess/i }));
    expect(onMove).toHaveBeenCalledWith(1, '100');
    expect(screen.getByText(/locked in at 100/i)).toBeDefined();
  });

  it('shows the final results to a remote-only player', () => {
    render(
      <SameBranchRemote
        state={state({ phase: 'complete', standings: [] })}
        me="p2"
        showResults
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByTestId('final-results')).toBeDefined();
  });
});
