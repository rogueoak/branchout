import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../lib/game-state';
import { ViewerPane } from './ViewerPane';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
];

function build(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    players,
    ...overrides,
  };
}

describe('ViewerPane answer display', () => {
  it('title-cases the revealed answers (stored lowercase, shown with caps)', () => {
    const state = build({
      phase: 'disputing',
      prompt: {
        round: 1,
        category: 'People',
        difficulty: 5,
        question: 'Who developed relativity?',
      },
      reveal: {
        round: 1,
        question: 'Who developed relativity?',
        answers: ['albert einstein', 'einstein'],
        correct: ['p1'],
        wrong: ['p2'],
      },
    });
    render(<ViewerPane state={state} me="p1" />);
    // The difficulty badge shows the plain-language band, not a raw number (rating 5 -> Medium).
    expect(screen.getByText('Medium')).toBeDefined();
    // The canonical answer is displayed title-cased, not verbatim-lowercase.
    expect(screen.getByText('Albert Einstein')).toBeDefined();
    expect(screen.queryByText('albert einstein')).toBeNull();
    // Alternates are title-cased too.
    expect(screen.getByText(/Also accepted: Einstein/)).toBeDefined();
  });
});
