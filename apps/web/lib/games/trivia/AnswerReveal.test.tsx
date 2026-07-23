import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnswerReveal } from './AnswerReveal';
import type { TriviaRoundReveal } from './protocol';

const players = [
  { player: 'p1', nickname: 'Ada', connected: true },
  { player: 'p2', nickname: 'Bo', connected: true },
];

function reveal(overrides: Partial<TriviaRoundReveal>): TriviaRoundReveal {
  return {
    round: 1,
    type: 'open',
    question: 'What is H2O?',
    answers: ['Water'],
    correct: ['p1'],
    wrong: ['p2'],
    submissions: [
      { player: 'p1', answer: 'water', correct: true },
      { player: 'p2', answer: 'juice', correct: false },
    ],
    ...overrides,
  };
}

describe('AnswerReveal correctness colour', () => {
  it('highlights the answer green when at least one player got it', () => {
    render(
      <AnswerReveal
        reveal={reveal({ correct: ['p1'], wrong: ['p2'] })}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={null}
      />,
    );
    expect(screen.getByTestId('reveal-answer').className).toContain('text-success');
    expect(screen.getByText('1 got it right')).toBeDefined();
  });

  it('highlights the answer red when nobody got it', () => {
    render(
      <AnswerReveal
        reveal={reveal({ correct: [], wrong: ['p1', 'p2'] })}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={null}
      />,
    );
    expect(screen.getByTestId('reveal-answer').className).toContain('text-danger');
    expect(screen.getByText('Nobody got it.')).toBeDefined();
  });
});

describe('AnswerReveal answers table', () => {
  it('renders each player answer in a table with a correct/wrong verdict', () => {
    render(
      <AnswerReveal
        reveal={reveal({})}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={null}
      />,
    );
    expect(screen.getByRole('table')).toBeDefined();
    // Column headers.
    expect(screen.getByRole('columnheader', { name: 'Player' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Answer' })).toBeDefined();
    // Each row carries the verdict in its accessible label (a check / x icon sits beside it).
    expect(screen.getByLabelText('Ada answered water, correct')).toBeDefined();
    expect(screen.getByLabelText('Bo answered juice, wrong')).toBeDefined();
  });
});

describe('AnswerReveal round type (spec 0074)', () => {
  it('labels the round type and shows the canonical option as the answer on a multiple-choice reveal', () => {
    render(
      <AnswerReveal
        reveal={reveal({
          type: 'multiple-choice',
          question: 'Fastest land animal?',
          answers: ['Cheetah'],
          correct: ['p1'],
          wrong: [],
          submissions: [
            { player: 'p1', answer: 'Cheetah', correct: true },
            { player: 'p2', answer: 'Lion', correct: false },
          ],
        })}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={null}
      />,
    );
    expect(screen.getByText('Multiple choice')).toBeDefined();
    expect(screen.getByTestId('reveal-answer').textContent).toBe('Cheetah');
    expect(screen.getByLabelText('Ada answered Cheetah, correct')).toBeDefined();
    expect(screen.getByLabelText('Bo answered Lion, wrong')).toBeDefined();
  });

  it('labels a true-false reveal and shows the correct verdict as the answer', () => {
    render(
      <AnswerReveal
        reveal={reveal({
          type: 'true-false',
          question: "A shrimp's heart is in its head.",
          answers: ['True'],
          correct: ['p1'],
          wrong: [],
          submissions: [{ player: 'p1', answer: 'True', correct: true }],
        })}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={null}
      />,
    );
    expect(screen.getByText('True or false')).toBeDefined();
    expect(screen.getByTestId('reveal-answer').textContent).toBe('True');
  });
});

describe('AnswerReveal auto-advance dwell', () => {
  it('shows a "Continuing in x seconds" countdown when auto-advance is on', () => {
    render(
      <AnswerReveal
        reveal={reveal({})}
        players={players}
        phase="disputing"
        disputeResult={null}
        dwellSecondsLeft={4}
      />,
    );
    expect(screen.getByText('Continuing in 4 seconds')).toBeDefined();
  });

  it('omits the countdown while a dispute is being voted on', () => {
    render(
      <AnswerReveal
        reveal={reveal({})}
        players={players}
        phase="voting"
        disputeResult={null}
        dwellSecondsLeft={4}
      />,
    );
    expect(screen.queryByText(/Continuing in/)).toBeNull();
    expect(screen.getByText(/dispute is being voted on/)).toBeDefined();
  });
});
