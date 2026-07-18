import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameCardData } from '../../lib/games/catalog';
import { GameCard } from './GameCard';

// The one unified game card (spec 0065). These tests pin the configurable contract: the badge row
// (tags stay in the data but are not rendered on the card), the show/hide of the Play and Details
// affordances, the top-right Insiders badge on an insider
// game, the selectable picker variant (aria-pressed + selection ring), and a 360px render guard.
// jsdom has no jest-dom here, so assertions check discriminating DOM properties (href/text/tag/role)
// rather than the get-then-`.toBeDefined()` anti-pattern (the Testing Library getters already throw on
// a miss, so a bare `.toBeDefined()` proves nothing).

// A public game fixture: a distinct hero + mark SVG (told apart by viewBox), a badge, and two tags.
const publicGame: GameCardData = {
  slug: 'demo-game',
  name: 'Demo Game',
  summary: 'A one-line summary of the demo game.',
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>',
  hero: '<svg viewBox="0 0 800 450"><rect width="800" height="450" /></svg>',
  badge: { label: 'Featured', variant: 'info' },
  tags: [
    { slug: 'trivia', label: 'Trivia' },
    { slug: 'quick', label: 'Quick' },
  ],
  insider: false,
};

const insiderGame: GameCardData = {
  ...publicGame,
  slug: 'secret-game',
  name: 'Secret Game',
  badge: { label: 'Insider', variant: 'primary' },
  insider: true,
};

describe('GameCard', () => {
  it('renders the hero, mark, name, badge, and summary but not the tags', () => {
    const { container } = render(<GameCard game={publicGame} />);
    // The name renders as the card's h3 heading.
    expect(screen.getByRole('heading', { name: 'Demo Game' }).tagName).toBe('H3');
    // Both the wide hero (800x450) and the compact mark (24x24) render as inline SVGs.
    expect(container.querySelector('svg[viewBox="0 0 800 450"]')).not.toBeNull();
    expect(container.querySelector('svg[viewBox="0 0 24 24"]')).not.toBeNull();
    // The catalog badge shows its exact label.
    expect(screen.getByText('Featured').textContent).toBe('Featured');
    // Tags stay in the card data but are NOT rendered on the card (they live on the game page); the
    // fixture's tags must not appear, and no tag list is emitted.
    expect(screen.queryByText('Trivia')).toBeNull();
    expect(screen.queryByText('Quick')).toBeNull();
    expect(container.querySelector('ul[role="list"]')).toBeNull();
    expect(screen.getByText(/one-line summary of the demo game/i).textContent).toContain(
      'demo game',
    );
  });

  it('shows the Play and Details affordances by default, each pointing at the right target', () => {
    render(<GameCard game={publicGame} />);
    // Play defaults to the room deep link; Details points at the game's feature page.
    expect(screen.getByRole('link', { name: /play demo game now/i }).getAttribute('href')).toBe(
      '/rooms?game=demo-game',
    );
    expect(
      screen.getByRole('link', { name: /details about demo game/i }).getAttribute('href'),
    ).toBe('/games/demo-game');
  });

  it('hides the Play affordance when showPlay is false', () => {
    render(<GameCard game={publicGame} showPlay={false} />);
    expect(screen.queryByRole('link', { name: /play demo game now/i })).toBeNull();
    expect(
      screen.getByRole('link', { name: /details about demo game/i }).getAttribute('href'),
    ).toBe('/games/demo-game');
  });

  it('hides the Details affordance when showDetails is false', () => {
    render(<GameCard game={publicGame} showDetails={false} />);
    expect(screen.getByRole('link', { name: /play demo game now/i }).getAttribute('href')).toBe(
      '/rooms?game=demo-game',
    );
    expect(screen.queryByRole('link', { name: /details about demo game/i })).toBeNull();
  });

  it('uses a supplied playHref for the Play affordance', () => {
    render(<GameCard game={publicGame} playHref="/signup?next=%2Frooms" />);
    expect(screen.getByRole('link', { name: /play demo game now/i }).getAttribute('href')).toBe(
      '/signup?next=%2Frooms',
    );
  });

  it('shows an Insiders badge and suppresses the duplicate catalog badge on an insider game', () => {
    render(<GameCard game={insiderGame} />);
    // The top-right badge reads "Insiders" ...
    expect(screen.getByText('Insiders').textContent).toBe('Insiders');
    // ... and the near-identical catalog badge (exact text "Insider") is suppressed so the card does
    // not show two pills that say the same thing.
    expect(screen.queryByText('Insider')).toBeNull();
  });

  it('shows no Insiders badge on a public game', () => {
    render(<GameCard game={publicGame} />);
    expect(screen.queryByText('Insiders')).toBeNull();
  });

  it('is a whole-card link when given href and neither affordance shows', () => {
    render(
      <GameCard game={publicGame} showPlay={false} showDetails={false} href="/games/demo-game" />,
    );
    const link = screen.getByRole('link', { name: /details about demo game/i });
    expect(link.getAttribute('href')).toBe('/games/demo-game');
  });

  describe('selectable picker variant', () => {
    it('is a pick button that reports the slug and forces both affordances off', () => {
      const onSelect = vi.fn();
      render(<GameCard game={publicGame} onSelect={onSelect} />);
      // No inner links: the card itself is the single pressable control.
      expect(screen.queryByRole('link')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /pick demo game/i }));
      expect(onSelect).toHaveBeenCalledWith('demo-game');
    });

    it('is presentational (not a button) without onSelect', () => {
      render(<GameCard game={publicGame} showPlay={false} showDetails={false} />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('marks the selected card with aria-pressed and a ring (not a second primary button)', () => {
      const { rerender } = render(
        <GameCard game={publicGame} onSelect={vi.fn()} selected={false} />,
      );
      const button = screen.getByRole('button', { name: /pick demo game/i });
      expect(button.getAttribute('aria-pressed')).toBe('false');
      // No selection ring while unselected (the ring is the only "selected" affordance).
      expect(button.querySelector('.ring-primary')).toBeNull();

      rerender(<GameCard game={publicGame} onSelect={vi.fn()} selected />);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.querySelector('.ring-primary')).not.toBeNull();
    });
  });

  it('reads well at 360px: the title wraps and nothing forces a nowrap line', () => {
    // The mobile-smoke learning: a button recipe leaking `white-space: nowrap` overflowed the phone.
    // Guard the structure that keeps the card within a 360px column - a min-w-0 + break-words title
    // and, scoped to the selectable wrapper, no nowrap-forcing class on the pressable control.
    render(<GameCard game={publicGame} onSelect={vi.fn()} />);
    const button = screen.getByRole('button', { name: /pick demo game/i });
    expect(button.querySelector('.min-w-0')).not.toBeNull();
    expect(button.querySelector('h3.break-words')).not.toBeNull();
    expect(button.querySelector('.whitespace-nowrap')).toBeNull();
  });
});
