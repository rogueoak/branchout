import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsiderHome } from './InsiderHome';

// The account menu (signed-in nav) uses next/navigation's useRouter; stub it for jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('InsiderHome (spec 0035)', () => {
  const viewer = { signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat', insider: true };
  // The insider surface the page always renders on: insider host + the apex link origin its chrome
  // crosses back to (feedback 0029). The page (server component) derives this via getSurface().
  const surface = { insider: true, linkOrigin: 'https://branchout.games' };

  it('renders the Insider heading and the nav surface label', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // The page heading plus the nav badge both read "Insider" (heading + label pill).
    expect(screen.getByRole('heading', { name: 'Insider' })).toBeDefined();
    expect(screen.getAllByText('Insider').length).toBeGreaterThanOrEqual(2);
  });

  it('lists the insider test games, each linking into a room on the SAME surface (feedback 0029)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Teeter Tower (the first insider-only game) is offered, not the empty state.
    expect(screen.queryByText(/no test games yet/i)).toBeNull();
    const card = screen.getByRole('link', { name: /start a room to test teeter tower/i });
    // Relative deep link even though the surface carries an apex origin: on the insider host it
    // rewrites into /insider/rooms, keeping the player on the insider surface (not bouncing to apex).
    expect(card.getAttribute('href')).toBe('/rooms?game=teeter-tower');
    // The card carries the game's mark (via the shared GameCard) - not just a bare title.
    expect(card.querySelector('svg')).not.toBeNull();
  });

  it('renders the shared account menu (main site look and feel)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    expect(screen.getByRole('button', { name: /account menu for cat/i })).toBeDefined();
  });

  it('crosses the shared chrome links to the apex origin via the surface (spec 0035)', () => {
    // The surface lives on the insider subdomain; nav/footer links to apex pages must be absolute or
    // they rewrite into the insider tree and 404. The origin comes from surface.linkOrigin.
    render(<InsiderHome viewer={viewer} surface={surface} />);
    expect(screen.getByRole('link', { name: 'Games' })).toHaveProperty(
      'href',
      'https://branchout.games/games',
    );
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      'https://branchout.games/privacy',
    );
  });
});
