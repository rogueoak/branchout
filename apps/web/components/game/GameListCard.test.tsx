import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameListCard, type GameListCardData } from './GameListCard';

// The shared listing card (spec 0046, extracted) used on BOTH the home teaser and the insider hub, so
// they cannot drift. It is purely presentational: hero art, mark + name, badge, summary, and an
// optional caller-supplied footer for the play/rules controls. These tests pin the badge + hero + name
// contract and the footer slot.

const game: GameListCardData = {
  slug: 'demo-game',
  name: 'Demo Game',
  summary: 'A one-line summary of the demo game.',
  // A minimal inline SVG stands in for the brand mark (not user input in real use).
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>',
  badge: { label: 'Insider', variant: 'primary' },
};

// A distinct hero SVG so we can tell the hero box apart from the header mark by its viewBox.
const hero = '<svg viewBox="0 0 800 450"><rect width="800" height="450" /></svg>';

describe('GameListCard', () => {
  it('renders the name, badge, and summary', () => {
    render(<GameListCard game={game} hero={hero} />);
    expect(screen.getByRole('heading', { name: 'Demo Game' })).toBeDefined();
    expect(screen.getByText('Insider')).toBeDefined();
    expect(screen.getByText(/one-line summary of the demo game/i)).toBeDefined();
  });

  it('renders both the hero illustration and the game mark', () => {
    const { container } = render(<GameListCard game={game} hero={hero} />);
    // The wide hero (800x450) and the compact mark (24x24) both render as inline SVGs.
    expect(container.querySelector('svg[viewBox="0 0 800 450"]')).not.toBeNull();
    expect(container.querySelector('svg[viewBox="0 0 24 24"]')).not.toBeNull();
  });

  it('renders a caller-supplied footer of controls inside the card', () => {
    render(
      <GameListCard game={game} hero={hero} footer={<button type="button">Play now</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Play now' })).toBeDefined();
  });

  it('carries no link or interactivity of its own (the caller owns the linking)', () => {
    const { container } = render(<GameListCard game={game} hero={hero} />);
    // Purely presentational: no anchor, so a caller can wrap it in a link without nesting.
    expect(container.querySelector('a')).toBeNull();
  });
});
