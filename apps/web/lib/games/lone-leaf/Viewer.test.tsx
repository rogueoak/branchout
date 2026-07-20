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
  it('names the Seeker in a prompt card with a countdown, never showing the word', () => {
    render(
      <LoneLeafViewer
        state={state({
          phase: 'collecting',
          round: 1,
          prompt,
          moveMsRemaining: 20_000,
          moveWindowMs: 30_000,
        })}
        me="p2"
      />,
    );
    // The prompt (who the Seeker is) sits in the canopy prompt card.
    expect(screen.getByTestId('lone-leaf-prompt').textContent).toMatch(/Ada is the Seeker/i);
    // The improved countdown is present (this is a timed round game).
    expect(screen.getByRole('timer')).toBeDefined();
    // Plain terms, and the viewer is broadcast to everyone - the word must never appear here.
    expect(screen.getByText(/matching clues cancel out/i)).toBeDefined();
    expect(screen.queryByText(/river/i)).toBeNull();
  });

  it('uses plain wording - no leaf/grove/wilt jargon while collecting', () => {
    const { container } = render(
      <LoneLeafViewer state={state({ phase: 'collecting', round: 1, prompt })} me="p2" />,
    );
    expect(container.textContent).not.toMatch(/\bleaf\b|\bleaves\b|grove|wilt/i);
  });

  it('shows the remaining clues while guessing (no word)', () => {
    render(
      <LoneLeafViewer
        state={state({ phase: 'guessing', round: 1, prompt, reveals: [survivorsReveal] })}
        me="p2"
      />,
    );
    expect(screen.getByText('flow')).toBeDefined();
    expect(screen.getByText('blue')).toBeDefined();
    expect(screen.getByText(/only the unique ones are left/i)).toBeDefined();
    expect(screen.queryByText(/river/i)).toBeNull();
  });

  it('reveals the word, the guess, and the removed clue at the leaderboard', () => {
    const { container } = render(
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
    // The hidden word is the focus of the reveal card, coloured green (the group got it).
    const word = screen.getByTestId('reveal-word');
    expect(word.textContent).toBe('river');
    expect(word.className).toContain('text-success');
    expect(screen.getByText(/your group guessed it/i)).toBeDefined();
    // The removed clue is shown with its author and a plain "removed" cue (no wilt jargon).
    expect(screen.getByText('water')).toBeDefined();
    expect(screen.getByLabelText(/Cy's clue water, removed/i)).toBeDefined();
    expect(container.textContent).not.toMatch(/grove|wilt/i);
  });
});
