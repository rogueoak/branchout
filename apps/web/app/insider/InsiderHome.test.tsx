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

  it('lists the insider test games, each linking into a room on the SAME surface (feedback 0028)', () => {
    // The apex origin is set, but the game card link must NOT use it: play stays on the insider
    // subdomain (the insider host now hosts the room flow), so the deep link is relative.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://branchout.games');
    try {
      render(<InsiderHome viewer={viewer} />);
      // Teeter Tower (the first insider-only game) is offered, not the empty state.
      expect(screen.queryByText(/no test games yet/i)).toBeNull();
      const card = screen.getByRole('link', { name: /start a room to test teeter tower/i });
      // Relative deep link: on the insider host it rewrites into /insider/rooms, keeping the player
      // on the insider surface instead of bouncing to the apex.
      expect(card.getAttribute('href')).toBe('/rooms?game=teeter-tower');
      // The card carries the game's mark (via the shared GameCard) - not just a bare title.
      expect(card.querySelector('svg')).not.toBeNull();
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
