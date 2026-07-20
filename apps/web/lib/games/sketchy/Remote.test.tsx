import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { SketchyRemote } from './Remote';

// canopy's ResponsiveDialog (the DrawCanvas Clear confirm) reads matchMedia; jsdom lacks it. Stub it,
// and stub the pointer-capture methods the DrawCanvas pointer handlers call (jsdom has no layout, so a
// down+up still commits a stroke the allowance tests can then undo).
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, ...overrides };
}

function noop() {}

/** Draw one stroke on the canvas (a pointer down + up commits it even without jsdom layout). */
function drawOneStroke() {
  const canvas = screen.getByLabelText(/draw your seed on the bark/i);
  fireEvent.pointerDown(canvas, { pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

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

  it('shows the featured player their own sketch while everyone else guesses', () => {
    const reveal = {
      round: 2,
      stage: 'sketch',
      featured: 'p1',
      sketch: { strokes: [{ color: '#0d0a15', points: [10, 10, 90, 90] }] },
      options: [
        { id: '0', text: 'a cat' },
        { id: '1', text: 'a dog' },
      ],
    };
    render(
      <SketchyRemote
        state={state({ round: 2, phase: 'guessing', reveals: [reveal] })}
        me="p1"
        onMove={noop}
        onVote={noop}
      />,
    );
    // The featured player sits out the vote (no option buttons) but watches their own drawing.
    expect(screen.getByText(/sit this one out/i)).toBeDefined();
    expect(screen.getByRole('img', { name: 'Your sketch' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'a cat' })).toBeNull();
  });

  it('keeps the undo allowance across rounds (per game, not per round)', () => {
    const { rerender } = render(
      <SketchyRemote
        state={state({ phase: 'collecting', prompt: drawPrompt, private: { seed: 'a penguin' } })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    // Fresh game: full undo allowance, but nothing to undo yet.
    expect(screen.getByRole('button', { name: /undo \(3 left\)/i })).toHaveProperty(
      'disabled',
      true,
    );
    // Draw a stroke, then spend one undo.
    drawOneStroke();
    fireEvent.click(screen.getByRole('button', { name: /undo \(3 left\)/i }));
    expect(screen.getByRole('button', { name: /undo \(2 left\)/i })).toBeDefined();

    // A new round resets the sketch but NOT the allowance - the count stays at 2.
    rerender(
      <SketchyRemote
        state={state({
          round: 2,
          phase: 'collecting',
          prompt: { round: 2, stage: 'draw' },
          private: { seed: 'a shark' },
        })}
        me="p2"
        onMove={noop}
        onVote={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /undo \(2 left\)/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /undo \(3 left\)/i })).toBeNull();
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
