import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { ViewerPane } from './Viewer';

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
  it('shows the revealed answers verbatim (stored in Title Case)', () => {
    const state = build({
      phase: 'disputing',
      prompt: {
        round: 1,
        category: 'People',
        difficulty: 5,
        question: 'Who developed relativity?',
      },
      reveals: [
        {
          round: 1,
          question: 'Who developed relativity?',
          answers: ['Albert Einstein', 'Einstein'],
          correct: ['p1'],
          wrong: ['p2'],
          submissions: [
            { player: 'p1', answer: 'Albert Einstein', correct: true },
            { player: 'p2', answer: 'Isaac Newton', correct: false },
          ],
        },
      ],
    });
    render(<ViewerPane state={state} me="p1" />);
    // The difficulty badge shows the plain-language band, not a raw number (rating 5 -> Medium).
    expect(screen.getByText('Medium')).toBeDefined();
    // The canonical answer is shown exactly as stored - Title Case lives in the data, not applied on
    // the fly at display time.
    expect(screen.getByText('Albert Einstein')).toBeDefined();
    // Alternates are shown as stored too.
    expect(screen.getByText(/Also accepted: Einstein/)).toBeDefined();
  });

  it("shows every player's submitted answer with a correct/wrong marker", () => {
    const state = build({
      phase: 'disputing',
      prompt: {
        round: 1,
        category: 'People',
        difficulty: 5,
        question: 'Who developed relativity?',
      },
      reveals: [
        {
          round: 1,
          question: 'Who developed relativity?',
          answers: ['Albert Einstein'],
          correct: ['p1'],
          wrong: ['p2'],
          submissions: [
            { player: 'p1', answer: 'albert einstein', correct: true },
            { player: 'p2', answer: 'isaac newton', correct: false },
          ],
        },
      ],
    });
    render(<ViewerPane state={state} me="p1" />);
    const list = screen.getByRole('list', { name: "Everyone's answers" });
    // Bo's wrong answer is shown to the whole table exactly as they typed it (verbatim, not recased).
    expect(screen.getByLabelText(/Bo answered isaac newton, wrong/)).toBeDefined();
    expect(list.textContent).toContain('isaac newton');
  });

  it('shows the answer countdown while collecting', () => {
    const state = build({
      phase: 'collecting',
      moveMsRemaining: 42_000,
      prompt: {
        round: 1,
        category: 'People',
        difficulty: 5,
        question: 'Who developed relativity?',
      },
    });
    render(<ViewerPane state={state} me="p1" />);
    expect(screen.getByRole('timer')).toBeDefined();
    expect(screen.getByText(/42s left/)).toBeDefined();
  });
});
