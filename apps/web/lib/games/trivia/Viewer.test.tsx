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
    // The canonical answer is the focus of the reveal, shown exactly as stored (Title Case lives in
    // the data, not applied on the fly).
    expect(screen.getByTestId('reveal-answer').textContent).toBe('Albert Einstein');
    // Alternates are shown as stored too.
    expect(screen.getByText(/Also accepted: Einstein/)).toBeDefined();
  });

  it("shows every player's submitted answer in a table with a correct/wrong marker", () => {
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
    // The answers land in a table; Bo's wrong guess is shown verbatim with a "wrong" verdict.
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByLabelText(/Bo answered isaac newton, wrong/)).toBeDefined();
    expect(screen.getByLabelText(/Ada answered albert einstein, correct/)).toBeDefined();
  });

  it('shows the answer countdown while collecting', () => {
    const state = build({
      phase: 'collecting',
      moveMsRemaining: 42_000,
      moveWindowMs: 60_000,
      answered: 1,
      prompt: {
        round: 1,
        type: 'open',
        category: 'People',
        difficulty: 5,
        question: 'Who developed relativity?',
      },
    });
    render(<ViewerPane state={state} me="p1" />);
    // The big central countdown carries the timer role; its accessible label spells the seconds out.
    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-label')).toBe('42 seconds left to answer');
    expect(timer.textContent).toBe('42');
  });

  it('shows the multiple-choice options on the shared viewer while collecting (spec 0074)', () => {
    const state = build({
      phase: 'collecting',
      moveMsRemaining: 20_000,
      moveWindowMs: 20_000,
      answered: 0,
      prompt: {
        round: 1,
        type: 'multiple-choice',
        category: 'Animals',
        difficulty: 3,
        question: 'Fastest land animal?',
        choices: ['Lion', 'Cheetah', 'Pronghorn', 'Greyhound'],
      },
    });
    render(<ViewerPane state={state} me="p1" />);
    expect(screen.getByRole('list', { name: /answer options/i })).toBeDefined();
    expect(screen.getByText('Cheetah')).toBeDefined();
    expect(screen.getByText('Multiple choice')).toBeDefined();
  });
});
