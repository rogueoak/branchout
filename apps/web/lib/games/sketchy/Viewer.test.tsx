import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { SketchyViewer } from './Viewer';

function state(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    round: 1,
    players: [
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ],
    ...overrides,
  };
}

describe('SketchyViewer', () => {
  it('shows the everyone-drawing cue during a draw round without leaking any seed', () => {
    render(
      <SketchyViewer
        state={state({ phase: 'collecting', prompt: { round: 1, stage: 'draw' } })}
        me="p1"
      />,
    );
    expect(screen.getByText(/everyone is drawing their secret seed/i)).toBeDefined();
  });

  it('lists the shuffled options while guessing', () => {
    render(
      <SketchyViewer
        state={state({
          round: 2,
          phase: 'guessing',
          reveals: [
            {
              round: 2,
              stage: 'sketch',
              featured: 'p1',
              sketch: { strokes: [] },
              options: [
                { id: '0', text: 'a cat' },
                { id: '1', text: 'a dog' },
              ],
            },
          ],
        })}
        me="p2"
      />,
    );
    expect(screen.getByText('a cat')).toBeDefined();
    expect(screen.getByText('a dog')).toBeDefined();
  });

  it('renders the sketch on the shared viewer in viewer-only mode (not sharing a device)', () => {
    render(
      <SketchyViewer
        state={state({
          round: 2,
          phase: 'guessing',
          reveals: [
            {
              round: 2,
              stage: 'sketch',
              featured: 'p1',
              sketch: { strokes: [{ color: '#0d0a15', points: [10, 10, 90, 90] }] },
              options: [{ id: '0', text: 'a cat' }],
            },
          ],
        })}
        me="p2"
      />,
    );
    expect(screen.getByRole('img', { name: /the sketch to guess/i })).toBeDefined();
  });

  it('suppresses the viewer sketch in interactive mode so the remote is the single canvas', () => {
    render(
      <SketchyViewer
        state={state({
          round: 2,
          phase: 'guessing',
          reveals: [
            {
              round: 2,
              stage: 'sketch',
              featured: 'p1',
              sketch: { strokes: [{ color: '#0d0a15', points: [10, 10, 90, 90] }] },
              options: [{ id: '0', text: 'a cat' }],
            },
          ],
        })}
        me="p2"
        sharesDeviceWithRemote
      />,
    );
    // The remote pane already shows this sketch in interactive mode, so the viewer must not duplicate
    // it - but the guessable option list still renders.
    expect(screen.queryByRole('img', { name: /the sketch to guess/i })).toBeNull();
    expect(screen.getByText('a cat')).toBeDefined();
  });

  it('suppresses the featured sketch during the decoy stage in interactive mode', () => {
    const decoyState = state({
      round: 2,
      phase: 'collecting',
      prompt: {
        round: 2,
        stage: 'sketch',
        featured: 'p1',
        sketch: { strokes: [{ color: '#0d0a15', points: [10, 10, 90, 90] }] },
      },
    });
    const { rerender } = render(<SketchyViewer state={decoyState} me="p2" />);
    expect(screen.getByRole('img', { name: /the featured sketch/i })).toBeDefined();
    rerender(<SketchyViewer state={decoyState} me="p2" sharesDeviceWithRemote />);
    expect(screen.queryByRole('img', { name: /the featured sketch/i })).toBeNull();
  });

  it('shows the true seed and who was fooled in the round result', () => {
    render(
      <SketchyViewer
        state={state({
          round: 2,
          phase: 'leaderboard',
          reveals: [
            {
              round: 2,
              stage: 'result',
              featured: 'p1',
              sketch: { strokes: [] },
              trueSeed: 'a cat',
              options: [
                { id: '0', text: 'a cat', kind: 'truth', pickedBy: ['p2'] },
                { id: '1', text: 'a dog', kind: 'decoy', author: 'p2', pickedBy: [] },
              ],
              correctGuessers: ['p2'],
            },
          ],
        })}
        me="p1"
      />,
    );
    expect(screen.getByText('a cat')).toBeDefined();
    expect(screen.getByText(/found the true seed: Bo/i)).toBeDefined();
  });
});
