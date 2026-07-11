import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '@rogueoak/canopy';
import { LandingContent } from '../components/LandingContent';

// The signed-in top nav renders the account menu, which uses next/navigation's useRouter; stub it so
// LandingContent renders in jsdom without a router context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// All tests render LandingContent directly to avoid mocking next/headers. The page.tsx server
// component is a thin session reader that passes the viewer to LandingContent, so testing
// LandingContent with both states covers the full observable surface of the route.

describe('home page - anonymous visitor', () => {
  it('renders hero section with the site tagline', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    // h1 carries the tagline; the Logo component renders the wordmark as an inline SVG.
    screen.getByRole('heading', { level: 1, name: /where game night grows/i });
  });

  it('renders the primary "Sign up free" CTA linking to /signup', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    const cta = screen.getByRole('link', { name: 'Sign up free' });
    expect(cta).toHaveProperty('href', expect.stringContaining('/signup'));
  });

  it('renders the header "Log in" link to /login', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    const loginLink = screen.getByRole('link', { name: 'Log in' });
    expect(loginLink).toHaveProperty('href', expect.stringContaining('/login'));
  });

  it('renders a secondary "Browse games" CTA', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    expect(screen.getByRole('link', { name: 'Browse games' })).toBeDefined();
  });

  it('renders the three "How it works" steps', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    screen.getByRole('heading', { name: /how it works/i });
    screen.getByRole('heading', { name: /make a room/i });
    screen.getByRole('heading', { name: /share the code/i });
    screen.getByRole('heading', { name: /play together/i });
  });

  it('does not render any pricing or plan content', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    expect(screen.queryByRole('heading', { name: /pick a plan/i })).toBeNull();
    expect(screen.queryByText(/USD|CAD|per month/i)).toBeNull();
  });

  it('renders the games teaser with both Trivia and Liar Liar', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    screen.getByRole('heading', { name: /what you can play/i });
    screen.getByRole('heading', { name: 'Trivia' });
    screen.getByRole('heading', { name: 'Liar Liar' });
  });

  it('renders each game card with its inline SVG game mark', () => {
    const { container } = render(<LandingContent viewer={{ signedIn: false }} />);
    // Each card links to the game's feature page with aria-label "Learn about <game>"; the game mark
    // is an inline SVG (from the brand package) inside that link, aria-hidden so it does not double
    // up the accessible name.
    for (const name of ['Learn about Trivia', 'Learn about Liar Liar']) {
      const card = screen.getByRole('link', { name: new RegExp(name, 'i') });
      expect(card.querySelector('svg')).not.toBeNull();
    }
    // Both marks plus the two arrow affordances render as SVGs.
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(4);
  });

  it('links each game card to its feature page (learn first, spec 0030)', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    const trivia = screen.getByRole('link', { name: /learn about trivia/i });
    expect(trivia).toHaveProperty('href', expect.stringContaining('/games/trivia'));
    const liarLiar = screen.getByRole('link', { name: /learn about liar liar/i });
    expect(liarLiar).toHaveProperty('href', expect.stringContaining('/games/liar-liar'));
  });

  it('renders a footer landmark', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('has a single primary CTA so the page has one clear action', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    // "Sign up free" is the single primary action; "Browse games" is secondary.
    const signupLinks = screen
      .getAllByRole('link')
      .filter((el) => el.textContent === 'Sign up free');
    expect(signupLinks).toHaveLength(1);
  });

  it('de-emphasizes the nav Sign up so the hero keeps the only primary (one-primary-per-view)', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    // The nav CTA on home is the outline variant, not a second primary competing with the hero.
    const navCta = screen.getByRole('link', { name: 'Sign up' });
    expect(navCta.className).toBe(buttonVariants({ variant: 'outline', size: 'sm' }));
  });
});

describe('home page - signed-in visitor', () => {
  it('shows "Play now" instead of "Sign up free"', () => {
    render(<LandingContent viewer={{ signedIn: true, gamerTag: 'CoolCat' }} />);
    expect(screen.queryByRole('link', { name: 'Sign up free' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Play now' })).toBeDefined();
  });

  it('still links the game cards to the feature pages when signed in (learn first, spec 0030)', () => {
    // The cards are learn-first (feature page) links regardless of auth; the play CTA lives on the
    // feature page and on the hero ("Play now"). So the card target does not change with sign-in.
    render(<LandingContent viewer={{ signedIn: true, gamerTag: 'CoolCat' }} />);
    expect(screen.getByRole('link', { name: /learn about trivia/i })).toHaveProperty(
      'href',
      expect.stringContaining('/games/trivia'),
    );
    expect(screen.getByRole('link', { name: /learn about liar liar/i })).toHaveProperty(
      'href',
      expect.stringContaining('/games/liar-liar'),
    );
  });

  it('hides the header "Log in" link (a signed-in visitor is already authenticated)', () => {
    render(<LandingContent viewer={{ signedIn: true, gamerTag: 'CoolCat' }} />);
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
  });

  it('still renders all content sections', () => {
    render(<LandingContent viewer={{ signedIn: true, gamerTag: 'CoolCat' }} />);
    screen.getByRole('heading', { level: 1 });
    screen.getByRole('heading', { name: /how it works/i });
    screen.getByRole('heading', { name: /what you can play/i });
  });
});

describe('home page - a11y basics', () => {
  it('has a navigation landmark for the site header nav', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    expect(screen.getByRole('navigation', { name: /site navigation/i })).toBeDefined();
  });

  it('has a header landmark', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    expect(screen.getByRole('banner')).toBeDefined();
  });

  it('all sections have accessible headings covering hero, steps, and games', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    const headings = screen.getAllByRole('heading');
    // At minimum: h1 (tagline), h2 (how it works, games) = 3, h3 (3 steps + trivia)
    expect(headings.length).toBeGreaterThanOrEqual(6);
  });

  it('wordmark has an accessible label', () => {
    render(<LandingContent viewer={{ signedIn: false }} />);
    // The Wordmark span has role="img"; getAllByRole handles any SVG internals that also match.
    const logoImgs = screen.getAllByRole('img', { name: /branch out/i });
    expect(logoImgs.length).toBeGreaterThanOrEqual(1);
  });
});
