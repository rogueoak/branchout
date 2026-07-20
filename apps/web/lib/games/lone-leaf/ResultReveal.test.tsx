import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@branchout/protocol';
import { ResultReveal } from './ResultReveal';
import type { LoneLeafResult } from './protocol';

const players: PlayerView[] = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
  { player: 'p3', nickname: 'Cy', connected: true },
];

function result(overrides: Partial<LoneLeafResult>): LoneLeafResult {
  return {
    round: 1,
    category: 'nature',
    seeker: 'p1',
    seed: 'river',
    guess: 'river',
    correct: true,
    survivors: ['flow'],
    leaves: [
      { player: 'p2', word: 'flow', survived: true },
      { player: 'p3', word: 'water', survived: false },
    ],
    ...overrides,
  };
}

describe('ResultReveal', () => {
  it('colours the word green and says the group got it when correct', () => {
    render(<ResultReveal result={result({ correct: true })} players={players} />);
    const word = screen.getByTestId('reveal-word');
    expect(word.textContent).toBe('river');
    expect(word.className).toContain('text-success');
    expect(screen.getByText(/your group guessed it/i)).toBeDefined();
  });

  it('colours the word red and says no one got it when the guess misses', () => {
    render(<ResultReveal result={result({ correct: false, guess: 'lake' })} players={players} />);
    const word = screen.getByTestId('reveal-word');
    expect(word.className).toContain('text-danger');
    expect(screen.getByText(/no one guessed it/i)).toBeDefined();
    // The Seeker's guess is echoed.
    expect(screen.getByText('lake')).toBeDefined();
  });

  it('marks kept clues with a check and removed clues as removed', () => {
    render(<ResultReveal result={result({})} players={players} />);
    expect(screen.getByLabelText(/Bo's clue flow, kept/i)).toBeDefined();
    expect(screen.getByLabelText(/Cy's clue water, removed/i)).toBeDefined();
  });

  it('counts down the auto-advance dwell when armed', () => {
    render(<ResultReveal result={result({})} players={players} dwellSecondsLeft={3} />);
    expect(screen.getByText(/Continuing in 3 seconds/i)).toBeDefined();
  });
});
