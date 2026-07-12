import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsiderHome } from './InsiderHome';

// The account menu (signed-in nav) uses next/navigation's useRouter; stub it for jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('InsiderHome (spec 0035)', () => {
  const viewer = { signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat', insider: true };

  it('renders the Insider heading and the nav surface label', () => {
    render(<InsiderHome viewer={viewer} />);
    // The page heading plus the nav badge both read "Insider" (heading + label pill).
    expect(screen.getByRole('heading', { name: 'Insider' })).toBeDefined();
    expect(screen.getAllByText('Insider').length).toBeGreaterThanOrEqual(2);
  });

  it('lists the insider test games, each linking into a solo room on the apex (spec 0043)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games');
    try {
      render(<InsiderHome viewer={viewer} />);
      // Teeter Tower (the first insider-only game) is offered, not the empty state.
      expect(screen.queryByText(/no test games yet/i)).toBeNull();
      const card = screen.getByRole('link', { name: /start a room to test teeter tower/i });
      // The card deep-links into the apex room-create flow with the game pre-selected.
      expect(card.getAttribute('href')).toBe('https://branchout.games/rooms?game=teeter-tower');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('renders the shared account menu (main site look and feel)', () => {
    render(<InsiderHome viewer={viewer} />);
    expect(screen.getByRole('button', { name: /account menu for cat/i })).toBeDefined();
  });

  it('crosses the shared chrome links to the apex origin (spec 0035)', () => {
    // The surface lives on the insider subdomain; nav/footer links to apex pages must be absolute or
    // they rewrite into the insider tree and 404.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games');
    try {
      render(<InsiderHome viewer={viewer} />);
      expect(screen.getByRole('link', { name: 'Games' })).toHaveProperty(
        'href',
        'https://branchout.games/games',
      );
      expect(screen.getByRole('link', { name: 'Privacy' })).toHaveProperty(
        'href',
        'https://branchout.games/privacy',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
