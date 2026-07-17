import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GamesBrowser, type BrowserGame } from './GamesBrowser';

// GamesBrowser filters against the real library entries (it calls searchLibrary/categoriesInUse by
// slug), so the fixtures use real slugs; only the display fields are stubbed.
// The chip `categories` mirror the real library entries so the filter test has DISCRIMINATING power:
// trivia is party-only, liar-liar declares deduction too - so filtering to `deduction` must drop
// Trivia and keep only Liar Liar. (The filter resolves categories by slug from the real library, so
// these must match GAME_LIBRARY: trivia -> [party], liar-liar -> [party, deduction].)
const games: BrowserGame[] = [
  {
    slug: 'trivia',
    name: 'Trivia',
    summary: 'A fast free-text trivia party game.',
    icon: '<svg />',
    href: '/games/trivia',
    categories: [{ slug: 'party', label: 'Party' }],
    tags: [{ slug: 'trivia', label: 'Trivia' }],
  },
  {
    slug: 'liar-liar',
    name: 'Liar Liar',
    summary: 'A bluffing party game.',
    icon: '<svg />',
    href: '/games/liar-liar',
    categories: [
      { slug: 'party', label: 'Party' },
      { slug: 'deduction', label: 'Deduction' },
    ],
    tags: [{ slug: 'bluffing', label: 'Bluffing' }],
  },
];

describe('GamesBrowser', () => {
  it('lists every game and its category/tag chips', () => {
    render(<GamesBrowser games={games} />);
    expect(screen.getByRole('link', { name: /learn about trivia/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /learn about liar liar/i })).toBeDefined();
    // Chips render (the category "Party" and a tag label).
    expect(screen.getAllByText('Party').length).toBeGreaterThan(0);
    expect(screen.getByText('Bluffing')).toBeDefined();
  });

  it('narrows the list by the search query', () => {
    render(<GamesBrowser games={games} />);
    fireEvent.change(screen.getByLabelText(/search games/i), { target: { value: 'liar' } });
    expect(screen.queryByRole('link', { name: /learn about trivia/i })).toBeNull();
    expect(screen.getByRole('link', { name: /learn about liar liar/i })).toBeDefined();
  });

  it('narrows the list by the category filter', () => {
    render(<GamesBrowser games={games} />);
    // Only liar-liar declares `deduction`, so filtering to it must DROP Trivia and keep only Liar
    // Liar - a discriminating assertion that fails if the filter is ignored.
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'deduction' } });
    expect(screen.queryByRole('link', { name: /learn about trivia/i })).toBeNull();
    expect(screen.getByRole('link', { name: /learn about liar liar/i })).toBeDefined();

    // Both games declare `party`, so filtering to it keeps both (only Trivia is party-only).
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'party' } });
    expect(screen.getByRole('link', { name: /learn about trivia/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /learn about liar liar/i })).toBeDefined();
  });

  it('shows a no-match state when nothing matches', () => {
    render(<GamesBrowser games={games} />);
    fireEvent.change(screen.getByLabelText(/search games/i), {
      target: { value: 'zzzznotathing' },
    });
    expect(screen.getByText(/no games match/i)).toBeDefined();
    expect(screen.queryByRole('link', { name: /learn about/i })).toBeNull();
  });
});
