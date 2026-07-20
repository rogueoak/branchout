import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { LoneLeafPromptCard } from './PromptCard';

function state(overrides: Partial<GameState>): GameState {
  return { ...initialGameState(), round: 1, moveWindowMs: 60_000, ...overrides };
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

describe('LoneLeafPromptCard structure', () => {
  it('shows the round and theme badges and the heading in a card', () => {
    render(
      <LoneLeafPromptCard state={state({ round: 2 })} round={2} category="nature" heading="Go">
        <p>body</p>
      </LoneLeafPromptCard>,
    );
    expect(screen.getByText('Round 2')).toBeDefined();
    expect(screen.getByText('Nature')).toBeDefined();
    expect(screen.getByTestId('lone-leaf-prompt').textContent).toBe('Go');
    expect(screen.getByText('body')).toBeDefined();
  });

  it('shows no countdown card when there is no timer', () => {
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: null })}
        round={1}
        category="food"
        heading="Write your clue"
      />,
    );
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByTestId('countdown-card')).toBeNull();
  });

  it('puts the countdown in its own card, separate from the prompt card', () => {
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 30_000 })}
        round={1}
        category="food"
        heading="Write your clue"
      />,
    );
    const countdownCard = screen.getByTestId('countdown-card');
    const timer = screen.getByRole('timer');
    const prompt = screen.getByTestId('lone-leaf-prompt');
    // The timer lives inside the dedicated countdown card...
    expect(countdownCard.contains(timer)).toBe(true);
    // ...and the prompt heading does NOT (it is in the card above).
    expect(countdownCard.contains(prompt)).toBe(false);
  });

  it('renders the countdown a step smaller than the prompt heading', () => {
    // Design-system text tokens, largest -> smallest. Assert the countdown reads a step SMALLER than
    // the heading rather than pinning an exact class (matches Trivia's WS16 treatment).
    const SIZE_RANK = ['text-display', 'text-h1', 'text-h2', 'text-h3', 'text-h4', 'text-body'];
    const rankOf = (className: string) =>
      SIZE_RANK.findIndex((token) => className.split(/\s+/).includes(token));
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 30_000 })}
        round={1}
        category="food"
        heading="Write your clue"
      />,
    );
    const prompt = screen.getByTestId('lone-leaf-prompt');
    const timer = screen.getByRole('timer');
    expect(rankOf(prompt.className)).toBeGreaterThanOrEqual(0);
    expect(rankOf(timer.className)).toBeGreaterThan(rankOf(prompt.className));
    // Guard the specific intent: no longer the oversized display size.
    expect(timer.className).not.toContain('text-display');
  });
});

describe('LoneLeafPromptCard countdown colour + blink', () => {
  afterEach(() => setReducedMotion(false));

  it('is neutral with most of the window left', () => {
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 45_000 })}
        round={1}
        category="food"
        heading="Go"
      />,
    );
    expect(screen.getByRole('timer').className).toContain('text-text');
  });

  it('turns warning at 30% left and does not blink', () => {
    // 60s window, 18s left = 30%.
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 18_000 })}
        round={1}
        category="food"
        heading="Go"
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-warning');
    expect(timer.className).not.toContain('animate-countdown-blink');
  });

  it('turns danger and blinks with the fast pulse at 10% left (motion allowed)', () => {
    // 60s window, 6s left = 10%.
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 6_000 })}
        round={1}
        category="food"
        heading="Go"
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    // The danger blink is the custom fast pulse (WS16), not Tailwind's slower animate-pulse.
    expect(timer.className).toContain('animate-countdown-blink');
    expect(timer.className).not.toContain('animate-pulse');
  });

  it('does not blink under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(
      <LoneLeafPromptCard
        state={state({ moveMsRemaining: 6_000 })}
        round={1}
        category="food"
        heading="Go"
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('text-danger');
    expect(timer.className).not.toContain('animate-countdown-blink');
  });
});
