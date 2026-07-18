import { render, screen, within } from '@testing-library/react';
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
    // One combined welcome heading + message, replacing the old bare "Insider" heading. The welcome is
    // centered (feedback 0030): assert the class so a regression cannot stay green.
    const heading = screen.getByRole('heading', { name: /branch out games for insiders/i });
    expect(heading.className).toContain('text-center');
    expect(screen.getByText(/unreleased games still in testing/i).tagName).toBe('P');
    expect(screen.getByText(/your feedback shapes what ships/i).tagName).toBe('P');
    // The nav still carries the "Insider" surface badge. Scope to the nav landmark: the insider game
    // cards carry an "Insiders" (plural) top-right badge, and scoping keeps this assertion pinned to
    // the surface badge rather than any card copy.
    const nav = screen.getByRole('navigation', { name: /site navigation/i });
    expect(within(nav).getByText('Insider').textContent).toBe('Insider');
  });

  it('offers a "Play now" CTA that is the RELATIVE play link on the Teeter Tower card (feedback 0030)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // A visible "Play now" affordance sits within each card link (its accessible name). More than one
    // insider game now ships, so there is a "Play now" per card.
    expect(screen.getAllByText('Play now').length).toBeGreaterThan(0);
    const card = screen.getByRole('link', { name: /play teeter tower now/i });
    expect(card.getAttribute('href')).toBe('/rooms?game=teeter-tower');
  });

  it('lists the insider test games, each linking into a room on the SAME surface (feedback 0029)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Teeter Tower (the first insider-only game) is offered, not the empty state.
    expect(screen.queryByText(/no test games yet/i)).toBeNull();
    // The "Play now" affordance is itself the play link (the card is no longer the link) - so there is
    // no interactive-in-interactive nesting. Assert the Teeter Tower one specifically (several insider
    // games are listed now), and that it deep-links relative into the room flow.
    const playLink = screen.getByRole('link', { name: /play teeter tower now/i });
    expect(playLink.textContent).toContain('Play now');
    // Relative deep link even though the surface carries an apex origin: on the insider host it
    // rewrites into /insider/rooms, keeping the player on the insider surface (not bouncing to apex).
    expect(playLink.getAttribute('href')).toBe('/rooms?game=teeter-tower');
  });

  it('lists the insider test games with the shared card (badge + hero mark), not the empty state', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Teeter Tower (an insider-only game) is offered, not the empty state.
    expect(screen.queryByText(/no test games yet/i)).toBeNull();
    // The card renders the game name as an h3 heading and the top-right "Insiders" badge (every insider
    // game carries it); its duplicate "Insider" catalog badge is suppressed. (The nav still carries its
    // own "Insider" surface badge, so the badge-suppression itself is asserted in GameCard.test.tsx.)
    expect(screen.getByRole('heading', { name: 'Teeter Tower' }).tagName).toBe('H3');
    expect(screen.getAllByText('Insiders').length).toBeGreaterThan(0);
  });

  it('renders "Play now" but NOT a Details link inside each insider card (Details deferred to spec 0030)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // The insider cards pass showDetails={false}: a "Details" link would point at /games/<slug>, which
    // has no route on the insider host and notFound()s on the apex (getCatalogEntry is public-only). So
    // only the relative "Play now" affordance shows; the insider per-game page arrives in spec 0030.
    const playLink = screen.getByRole('link', { name: /play teeter tower now/i });
    expect(playLink.getAttribute('href')).toBe('/rooms?game=teeter-tower');
    expect(screen.queryByRole('link', { name: /details about teeter tower/i })).toBeNull();
  });

  it('shows a top-right "Insiders" badge and no rules sheet on the card (spec 0065)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Rules now live on the game's page (Details), not in a card sheet: no "How to play" trigger and
    // no dialog on the insider landing card.
    expect(screen.queryByRole('button', { name: /how to play/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Every insider game card carries the extra "Insiders" badge beside the title.
    expect(screen.getAllByText('Insiders').length).toBeGreaterThan(0);
  });

  it('renders the shared account menu (main site look and feel)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    expect(screen.getByRole('button', { name: /account menu for cat/i }).tagName).toBe('BUTTON');
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
