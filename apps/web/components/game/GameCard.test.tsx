import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { triviaGameUi } from '../../lib/games/trivia';
import { GameCard } from './GameCard';

describe('GameCard', () => {
  it('shows the game name, tagline, and summary so a host chooses knowing what it is', () => {
    render(<GameCard game={triviaGameUi} />);
    expect(screen.getByRole('heading', { name: 'Trivia' })).toBeDefined();
    expect(screen.getByText(triviaGameUi.tagline)).toBeDefined();
    expect(screen.getByText(triviaGameUi.summary)).toBeDefined();
  });

  it('is a pick button that reports the game id when onSelect is provided', () => {
    const onSelect = vi.fn();
    render(<GameCard game={triviaGameUi} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /pick trivia/i }));
    expect(onSelect).toHaveBeenCalledWith('trivia');
  });

  it('is presentational (not a button) without onSelect', () => {
    render(<GameCard game={triviaGameUi} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
