import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@branchout/protocol';
import { initialGameState, type GameState } from '../../game-state';
import { LoneLeafViewer } from './Viewer';

const players: PlayerView[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

const prompt = { round: 1, category: 'nature', seeker: 'p1' };
const survivorsReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  survivors: ['flow', 'blue'],
  leaves: [
    { player: 'p2', word: 'flow', survived: true },
    { player: 'p3', word: 'water', survived: false },
  ],
};
const resultReveal = {
  round: 1,
  category: 'nature',
  seeker: 'p1',
  seed: 'river',
  guess: 'river',
  correct: true,
  survivors: ['flow', 'blue'],
  leaves: survivorsReveal.leaves,
};

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), players, ...overrides };
}

describe('LoneLeafViewer', () => {
  it('names the Seeker while collecting and never shows the seed', () => {
    render(<LoneLeafViewer state={state({ phase: 'collecting', round: 1, prompt })} me="p2" />);
    expect(screen.getByText(/Ada is the Seeker/i)).toBeDefined();
    // The viewer is broadcast to everyone; the seed must never appear here.
    expect(screen.queryByText(/river/i)).toBeNull();
  });

  it('shows the surviving leaves while guessing (no seed)', () => {
    render(
      <LoneLeafViewer
        state={state({ phase: 'guessing', round: 1, prompt, reveals: [survivorsReveal] })}
        me="p2"
      />,
    );
    expect(screen.getByText('flow')).toBeDefined();
    expect(screen.getByText('blue')).toBeDefined();
    expect(screen.queryByText(/river/i)).toBeNull();
  });

  it('reveals the seed, the guess, and the wilted leaves at the leaderboard', () => {
    render(
      <LoneLeafViewer
        state={state({
          phase: 'leaderboard',
          round: 1,
          prompt,
          reveals: [survivorsReveal, resultReveal],
          standings: [
            { player: 'p1', nickname: 'Ada', rank: 1, score: 1 },
            { player: 'p2', nickname: 'Bo', rank: 1, score: 1 },
          ],
        })}
        me="p2"
      />,
    );
    // The seed appears (both named as the seed and echoed in the guess line).
    expect(screen.getAllByText('river').length).toBeGreaterThan(0);
    expect(screen.getByText(/the grove banked it/i)).toBeDefined();
    // The wilted leaf is shown with its author and the wilted note.
    expect(screen.getByText('water')).toBeDefined();
    expect(screen.getByText(/Cy - wilted/)).toBeDefined();
  });
});
