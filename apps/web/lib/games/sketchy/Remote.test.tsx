import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { SketchyRemote } from './Remote';

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

const drawPrompt = { round: 1, stage: 'draw' };
const sketchPrompt = {
  round: 2,
  stage: 'sketch',
  featured: 'p1',
  sketch: { strokes: [{ color: '#0d0a15', points: [0, 0, 100, 100] }] },
};
const optionsReveal = {
  round: 2,
  stage: 'sketch',
  featured: 'p1',
  sketch: { strokes: [] },
  options: [
    { id: '0', text: 'a cat' },
    { id: '1', text: 'a dog' },
  ],
};

describe('SketchyRemote', () => {
  it('shows the local seed from the private payload during a draw round', () => {
    render(
      <SketchyRemote
        state={state({ phase: 'collecting', prompt: drawPrompt, private: { seed: 'a penguin' } })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    // The seed is shown to the local drawing player (delivered privately, spec 0052).
    expect(screen.getByText('a penguin')).toBeDefined();
    expect(screen.getByLabelText(/draw your seed on the bark/i)).toBeDefined();
  });

  it('takes a decoy during a sketch round (non-featured player)', () => {
    const onMove = vi.fn();
    render(
      <SketchyRemote
        state={state({ round: 2, phase: 'collecting', prompt: sketchPrompt })}
        me="p2"
        onMove={onMove}
        onVote={noop}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/convincing fake seed/i), {
      target: { value: 'a wolf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onMove).toHaveBeenCalledWith(2, 'a wolf');
    expect(screen.getByText(/decoy submitted/i)).toBeDefined();
  });

  it('lets the featured player sit out the decoy stage', () => {
    render(
      <SketchyRemote
        state={state({ round: 2, phase: 'collecting', prompt: sketchPrompt })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByText(/this is your sketch/i)).toBeDefined();
    expect(screen.queryByPlaceholderText(/convincing fake seed/i)).toBeNull();
  });

  it('offers the options to guess and casts a vote', () => {
    const onVote = vi.fn();
    render(
      <SketchyRemote
        state={state({ round: 2, phase: 'guessing', reveals: [optionsReveal] })}
        me="p2"
        onMove={noop}
        onVote={onVote}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'a cat' }));
    expect(onVote).toHaveBeenCalledWith(2, '0', true);
  });
});
