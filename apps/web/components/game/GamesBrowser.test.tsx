import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameCardData } from '../../lib/games/catalog';
import { GamesBrowser } from './GamesBrowser';

// GamesBrowser filters against the real library entries (it calls searchLibrary/categoriesInUse by
// slug), so the fixtures use real slugs; only the display fields are stubbed. Each row now renders the
// unified GameCard (spec 0065), so a game is identified by its "Play <name> now" / "Details about
// <name>" affordances rather than the old "Learn about <name>" whole-card link.
// The chip `tags` mirror the real library entries so the filter test has DISCRIMINATING power:
// trivia is party-only, liar-liar declares deduction too - so filtering to `deduction` must drop
// Trivia and keep only Liar Liar. (The filter resolves categories by slug from the real library.)
const games: GameCardData[] = [
  {
    slug: 'trivia',
    name: 'Trivia',
    summary: 'A fast free-text trivia party game.',
    icon: '<svg viewBox="0 0 24 24" />',
    hero: '<svg viewBox="0 0 800 450" />',
    badge: { label: 'Featured', variant: 'info' },
    // A tag label distinct from the game name so a chip assertion cannot collide with the heading.
    tags: [{ slug: 'quick', label: 'Quick' }],
    insider: false,
  },
  {
    slug: 'liar-liar',
    name: 'Liar Liar',
    summary: 'A bluffing party game.',
    icon: '<svg viewBox="0 0 24 24" />',
    hero: '<svg viewBox="0 0 800 450" />',
    badge: { label: 'New', variant: 'success' },
    tags: [{ slug: 'bluffing', label: 'Bluffing' }],
    insider: false,
  },
];

describe('GamesBrowser', () => {
  it('lists every game with its Play + Details affordances and tag chips', () => {
    render(<GamesBrowser games={games} signedIn />);
    expect(screen.getByRole('link', { name: /details about trivia/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /details about liar liar/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /play trivia now/i })).toBeDefined();
    // Tag chips render.
    expect(screen.getByText('Quick')).toBeDefined();
    expect(screen.getByText('Bluffing')).toBeDefined();
  });

  it('routes an anonymous visitor through signup on Play', () => {
    render(<GamesBrowser games={games} signedIn={false} />);
    expect(screen.getByRole('link', { name: /play trivia now/i }).getAttribute('href')).toContain(
      '/signup',
    );
  });

  it('sends a signed-in visitor straight to the room deep link on Play', () => {
    render(<GamesBrowser games={games} signedIn />);
    expect(screen.getByRole('link', { name: /play trivia now/i }).getAttribute('href')).toBe(
      '/rooms?game=trivia',
    );
  });

  it('narrows the list by the search query', () => {
    render(<GamesBrowser games={games} signedIn />);
    fireEvent.change(screen.getByLabelText(/search games/i), { target: { value: 'liar' } });
    expect(screen.queryByRole('link', { name: /details about trivia/i })).toBeNull();
    expect(screen.getByRole('link', { name: /details about liar liar/i })).toBeDefined();
  });

  it('narrows the list by the category filter', () => {
    render(<GamesBrowser games={games} signedIn />);
    // Only liar-liar declares `deduction`, so filtering to it must DROP Trivia and keep only Liar
    // Liar - a discriminating assertion that fails if the filter is ignored.
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'deduction' } });
    expect(screen.queryByRole('link', { name: /details about trivia/i })).toBeNull();
    expect(screen.getByRole('link', { name: /details about liar liar/i })).toBeDefined();

    // Both games declare `party`, so filtering to it keeps both (only Trivia is party-only).
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'party' } });
    expect(screen.getByRole('link', { name: /details about trivia/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /details about liar liar/i })).toBeDefined();
  });

  it('shows a no-match state when nothing matches', () => {
    render(<GamesBrowser games={games} signedIn />);
    fireEvent.change(screen.getByLabelText(/search games/i), {
      target: { value: 'zzzznotathing' },
    });
    expect(screen.getByText(/no games match/i)).toBeDefined();
    expect(screen.queryByRole('link', { name: /details about/i })).toBeNull();
  });
});
