import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { TriviaQuestionCard } from './QuestionCard';
import type { TriviaPrompt } from './protocol';

const PROMPT: TriviaPrompt = {
  round: 1,
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

  it('turns danger and blinks at 10% remaining (motion allowed)', () => {
    // 60s window, 6s left = 10%.
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 6_000 })} prompt={PROMPT} />);
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    expect(timer.className).toContain('animate-pulse');
  });

  it('does not blink under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<TriviaQuestionCard state={build({ moveMsRemaining: 6_000 })} prompt={PROMPT} />);
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    expect(timer.className).not.toContain('animate-pulse');
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
