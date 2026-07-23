import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { TriviaQuestionCard } from './QuestionCard';
import type { TriviaPrompt } from './protocol';

const PROMPT: TriviaPrompt = {
  round: 1,
  type: 'open',
  category: 'Science',
  difficulty: 5,
  question: 'What is H2O?',
};

function build(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState(),
    joined: true,
    connection: 'live',
    round: 1,
    players: [
      { player: 'p1', nickname: 'Ada', connected: true },
      { player: 'p2', nickname: 'Bo', connected: true },
    ],
    phase: 'collecting',
    moveWindowMs: 60_000,
    ...overrides,
  };
}

/** Force `prefers-reduced-motion: reduce` to match (or not) for the next render. */
function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('TriviaQuestionCard countdown colour', () => {
  afterEach(() => setReducedMotion(false));

  it('is neutral with most of the window left', () => {
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 45_000 })} prompt={PROMPT} />);
    expect(screen.getByRole('timer').className).toContain('text-text');
    expect(screen.getByRole('timer').className).not.toContain('text-warning');
  });

  it('turns warning at 30% of the window remaining', () => {
    // 60s window, 18s left = 30%.
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 18_000 })} prompt={PROMPT} />);
    expect(screen.getByRole('timer').className).toContain('text-warning');
  });

  it('turns danger and blinks with the fast pulse at 10% remaining (motion allowed)', () => {
    // 60s window, 6s left = 10%.
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 6_000 })} prompt={PROMPT} />);
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    // The danger blink is the custom fast pulse (WS16), not Tailwind's slower animate-pulse.
    expect(timer.className).toContain('animate-countdown-blink');
    expect(timer.className).not.toContain('animate-pulse');
  });

  it('does not blink under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 6_000 })} prompt={PROMPT} />);
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    expect(timer.className).not.toContain('animate-countdown-blink');
  });

  it('does not use the fast pulse in the warning zone', () => {
    // 60s window, 18s left = 30% (warning), which never blinks.
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 18_000 })} prompt={PROMPT} />);
    expect(screen.getByRole('timer').className).not.toContain('animate-countdown-blink');
  });

  it('shows "Paused" instead of a number while paused', () => {
    render(
      <TriviaQuestionCard
        state={build({ moveMsRemaining: 6_000, paused: true })}
        prompt={PROMPT}
      />,
    );
    expect(screen.getByRole('timer').textContent).toBe('Paused');
  });
});

describe('TriviaQuestionCard answered indicator', () => {
  it('shows "x of y players answered" from the engine count and connected roster', () => {
    render(
      <TriviaQuestionCard
        state={build({ moveMsRemaining: 30_000, answered: 1 })}
        prompt={PROMPT}
      />,
    );
    expect(screen.getByText('1 of 2 players answered')).toBeDefined();
  });

  it('reads sensibly in a solo game', () => {
    const state = build({
      moveMsRemaining: 30_000,
      answered: 0,
      players: [{ player: 'p1', nickname: 'Ada', connected: true }],
    });
    render(<TriviaQuestionCard state={state} prompt={PROMPT} />);
    expect(screen.getByText('0 of 1 player answered')).toBeDefined();
  });

  it('omits the answered line when the engine does not report a count', () => {
    render(
      <TriviaQuestionCard
        state={build({ moveMsRemaining: 30_000, answered: null })}
        prompt={PROMPT}
      />,
    );
    expect(screen.queryByText(/answered$/)).toBeNull();
  });
});

describe('TriviaQuestionCard question types (spec 0074)', () => {
  it('shows a round-type badge for the current question', () => {
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={PROMPT} />);
    expect(screen.getByText('Open answer')).toBeDefined();
  });

  it('lists the four options (read-only) on a multiple-choice round', () => {
    const prompt: TriviaPrompt = {
      round: 2,
      type: 'multiple-choice',
      category: 'Animals',
      difficulty: 3,
      question: 'Fastest land animal?',
      choices: ['Lion', 'Cheetah', 'Pronghorn', 'Greyhound'],
    };
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={prompt} />);
    const options = screen.getByRole('list', { name: /answer options/i });
    expect(options).toBeDefined();
    for (const choice of prompt.choices ?? []) {
      expect(screen.getByText(choice)).toBeDefined();
    }
    expect(screen.getByText('Multiple choice')).toBeDefined();
  });

  it('shows True / False options on a true-false round', () => {
    const prompt: TriviaPrompt = {
      round: 3,
      type: 'true-false',
      category: 'Animals',
      difficulty: 4,
      question: "A shrimp's heart is in its head.",
    };
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={prompt} />);
    expect(screen.getByText('True')).toBeDefined();
    expect(screen.getByText('False')).toBeDefined();
    expect(screen.getByText('True or false')).toBeDefined();
  });

  it('shows no options on an open round', () => {
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={PROMPT} />);
    expect(screen.queryByRole('list', { name: /answer options/i })).toBeNull();
  });
});

describe('TriviaQuestionCard countdown size and card', () => {
  // Design-system text tokens, largest -> smallest. Used to assert the countdown reads a step SMALLER
  // than the question rather than pinning an exact class (WS16).
  const SIZE_RANK = ['text-display', 'text-h1', 'text-h2', 'text-h3', 'text-h4', 'text-body'];
  const rankOf = (className: string) =>
    SIZE_RANK.findIndex((token) => className.split(/\s+/).includes(token));

  it('renders the countdown a step smaller than the question', () => {
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={PROMPT} />);
    const question = screen.getByTestId('question-prompt');
    const timer = screen.getByRole('timer');
    // Both carry a known size token, and the countdown's token ranks strictly below the question's
    // (a larger rank index == smaller text).
    expect(rankOf(question.className)).toBeGreaterThanOrEqual(0);
    expect(rankOf(timer.className)).toBeGreaterThan(rankOf(question.className));
    // Guard the specific intent: no longer the oversized display size.
    expect(timer.className).not.toContain('text-display');
  });

  it('puts the countdown in its own card, separate from the question card', () => {
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 30_000 })} prompt={PROMPT} />);
    const countdownCard = screen.getByTestId('countdown-card');
    const timer = screen.getByRole('timer');
    const question = screen.getByTestId('question-prompt');
    // The timer lives inside the dedicated countdown card...
    expect(countdownCard.contains(timer)).toBe(true);
    // ...and the question does NOT (it is in the card above).
    expect(countdownCard.contains(question)).toBe(false);
  });
});
