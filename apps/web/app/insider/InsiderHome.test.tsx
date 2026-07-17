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

  it('renders a single centered welcome that carries the insider identity (feedback 0030)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // One combined welcome heading + message, replacing the old bare "Insider" heading.
    const heading = screen.getByRole('heading', { name: /branch out games for insiders/i });
    expect(heading).toBeDefined();
    // The welcome is centered (feedback 0030): assert the class so a regression cannot stay green.
    expect(heading.className).toContain('text-center');
    expect(screen.getByText(/unreleased games still in testing/i)).toBeDefined();
    expect(screen.getByText(/your feedback shapes what ships/i)).toBeDefined();
    // The nav still carries the "Insider" surface badge.
    expect(screen.getByText('Insider')).toBeDefined();
  });

  it('offers a "Play now" CTA on the Teeter Tower card (feedback 0030)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // A visible "Play now" affordance sits within each insider game card link (its accessible name).
    // There is now more than one insider game (Teeter Tower, Reversi), so assert on the Teeter card.
    expect(screen.getAllByText('Play now').length).toBeGreaterThan(0);
    const card = screen.getByRole('link', { name: /play teeter tower now/i });
    expect(card.getAttribute('href')).toBe('/rooms?game=teeter-tower');
  });

  it('lists the insider test games, each linking into a room on the SAME surface (feedback 0029)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Teeter Tower (the first insider-only game) is offered, not the empty state.
    expect(screen.queryByText(/no test games yet/i)).toBeNull();
    const card = screen.getByRole('link', { name: /play teeter tower now/i });
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

  it('crosses APEX-ONLY chrome links to the apex, but keeps surface-owned nav on the host (feedback 0030)', () => {
    // The surface lives on the insider subdomain. Apex-only links (Privacy, and when signed out
    // Log in / Sign up) must be absolute or they rewrite into the insider tree and 404. But the
    // surface-owned links (the wordmark/home and Games) stay on the insider host - Games reaches the
    // insider games on the landing, not the apex public games.
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Apex-only footer legal link still crosses.
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      'https://branchout.games/privacy',
    );
    // Surface-owned: Games and the wordmark stay relative on the insider host (not crossed to apex).
    expect(screen.getByRole('link', { name: 'Games' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /branch out games home/i }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('keeps the signed-out apex-only auth links crossing to the apex (feedback 0030)', () => {
    // A signed-out insider still logs in / signs up on the apex (no insider auth pages).
    render(<InsiderHome viewer={{ signedIn: false }} surface={surface} />);
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
      'https://branchout.games/login',
    );
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
      'https://branchout.games/signup',
    );
  });
});
