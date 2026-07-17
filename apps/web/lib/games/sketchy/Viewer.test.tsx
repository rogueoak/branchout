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
