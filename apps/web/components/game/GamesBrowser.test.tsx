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
  it('lists every game with its Play + Details affordances, and shows no tag chips on the cards', () => {
    render(<GamesBrowser games={games} signedIn />);
    // Each card carries a Details link to the feature page and a Play link to the room deep link.
    expect(screen.getByRole('link', { name: /details about trivia/i }).getAttribute('href')).toBe(
      '/games/trivia',
    );
    expect(
      screen.getByRole('link', { name: /details about liar liar/i }).getAttribute('href'),
    ).toBe('/games/liar-liar');
    expect(screen.getByRole('link', { name: /play trivia now/i }).getAttribute('href')).toBe(
      '/rooms?game=trivia',
    );
    // Tags stay in the card data (they still drive the search/filter below and the game page) but are
    // NOT rendered on the cards - the fixture's tag labels must not appear.
    expect(screen.queryByText('Quick')).toBeNull();
    expect(screen.queryByText('Bluffing')).toBeNull();
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
    expect(
      screen.getByRole('link', { name: /details about liar liar/i }).getAttribute('href'),
    ).toBe('/games/liar-liar');
  });

  it('narrows the list by the category filter', () => {
    render(<GamesBrowser games={games} signedIn />);
    // Only liar-liar declares `deduction`, so filtering to it must DROP Trivia and keep only Liar
    // Liar - a discriminating assertion that fails if the filter is ignored.
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'deduction' } });
    expect(screen.queryByRole('link', { name: /details about trivia/i })).toBeNull();
    expect(
      screen.getByRole('link', { name: /details about liar liar/i }).getAttribute('href'),
    ).toBe('/games/liar-liar');

    // Both games declare `party`, so filtering to it keeps both (only Trivia is party-only).
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'party' } });
    expect(screen.getByRole('link', { name: /details about trivia/i }).getAttribute('href')).toBe(
      '/games/trivia',
    );
    expect(
      screen.getByRole('link', { name: /details about liar liar/i }).getAttribute('href'),
    ).toBe('/games/liar-liar');
  });

  it('shows a no-match state when nothing matches', () => {
    render(<GamesBrowser games={games} signedIn />);
    fireEvent.change(screen.getByLabelText(/search games/i), {
      target: { value: 'zzzznotathing' },
    });
    expect(screen.getByText(/no games match/i).textContent).toMatch(/no games match/i);
    expect(screen.queryByRole('link', { name: /details about/i })).toBeNull();
  });
});
