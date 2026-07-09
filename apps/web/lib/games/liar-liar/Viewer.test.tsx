import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@branchout/protocol';
import { initialGameState, type GameState } from '../../game-state';
import { LiarLiarViewer } from './Viewer';

const players: PlayerView[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

const prompt = { round: 1, clue: 'A museum is dedicated entirely to ___.', category: 'places' };
const optionsReveal = {
  round: 1,
  clue: prompt.clue,
  options: [
    { id: '0', text: 'penguins' },
    { id: '1', text: 'buttons' },
  ],
};
const resultReveal = {
  round: 1,
  clue: prompt.clue,
  truth: 'ramen',
  options: [
    { id: '0', text: 'ramen', kind: 'truth', pickedBy: ['p2'] },
    { id: '1', text: 'buttons', kind: 'fake', author: 'p1', pickedBy: ['p3'] },
  ],
  correctGuessers: ['p2'],
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), players, ...overrides };
}

describe('LiarLiarViewer', () => {
  it('shows the clue and the write-a-lie prompt while collecting', () => {
    render(<LiarLiarViewer state={state({ phase: 'collecting', round: 1, prompt })} me="p2" />);
    expect(screen.getByText(prompt.clue)).toBeDefined();
    expect(screen.getByText(/writing a convincing lie/i)).toBeDefined();
  });

  it('shows the options to guess while guessing', () => {
    render(
      <LiarLiarViewer
        state={state({ phase: 'guessing', round: 1, prompt, reveals: [optionsReveal] })}
        me="p2"
      />,
    );
    expect(screen.getByText(/which one is the truth/i)).toBeDefined();
    expect(screen.getByText('penguins')).toBeDefined();
    expect(screen.getByText('buttons')).toBeDefined();
  });

  it('reveals the truth and who fooled whom at the leaderboard', () => {
    render(
      <LiarLiarViewer
        state={state({
          phase: 'leaderboard',
          round: 1,
          prompt,
          reveals: [optionsReveal, resultReveal],
          standings: [
            { player: 'p1', nickname: 'Ada', rank: 1, score: 50 },
            { player: 'p2', nickname: 'Bo', rank: 2, score: 100 },
          ],
        })}
        me="p2"
      />,
    );
    expect(screen.getAllByText('ramen').length).toBeGreaterThan(0);
    // Ada's fake fooled Cy; the attribution names both.
    expect(screen.getByText(/Lie by Ada/)).toBeDefined();
    expect(screen.getByText(/fooled Cy/)).toBeDefined();
    expect(screen.getByText(/Guessed the truth: Bo/)).toBeDefined();
  });
});
