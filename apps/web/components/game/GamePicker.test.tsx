import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GAME_UI_LIST } from '../../lib/games/registry';
import { GamePicker } from './GamePicker';

describe('GamePicker', () => {
  it('renders one pick button per registered game (add a game = add a registry entry)', () => {
    render(<GamePicker selected="trivia" onSelect={vi.fn()} />);
    // Every registered game surfaces as a "Pick <name>" button.
    for (const game of GAME_UI_LIST) {
      expect(
        screen.getByRole('button', { name: new RegExp(`pick ${game.name}`, 'i') }),
      ).toBeDefined();
    }
  });

  it('reports the chosen game id to onSelect', () => {
    const onSelect = vi.fn();
    render(<GamePicker selected="trivia" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /pick liar liar/i }));
    expect(onSelect).toHaveBeenCalledWith('liar-liar');
  });

  it('marks the selected game with aria-pressed', () => {
    render(<GamePicker selected="liar-liar" onSelect={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /pick liar liar/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: /pick trivia/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
