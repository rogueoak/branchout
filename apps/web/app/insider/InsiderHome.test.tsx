import { fireEvent, render, screen, within } from '@testing-library/react';
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
    // The nav still carries the "Insider" surface badge. Scope to the nav landmark: the insider game
    // cards now also render an "Insider" catalog badge, so a bare getByText would match several.
    const nav = screen.getByRole('navigation', { name: /site navigation/i });
    expect(within(nav).getByText('Insider')).toBeDefined();
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
    // The card renders the game name as a heading and the "Insider" catalog badge (there is at least
    // one - every insider game carries it), matching the main-site card look.
    expect(screen.getByRole('heading', { name: 'Teeter Tower' })).toBeDefined();
    expect(screen.getAllByText('Insider').length).toBeGreaterThan(0);
  });

  it('renders the "Play now" and "How to play" controls inside each card', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // Both controls sit in the same card body: the play link and its sibling rules button share a
    // controls row. Locate the Teeter card by its play link, then the shared controls container.
    const playLink = screen.getByRole('link', { name: /play teeter tower now/i });
    const controls = playLink.parentElement;
    expect(controls).not.toBeNull();
    // The "How to play" trigger is a sibling of the play link in the same controls row (not nested).
    const howTo = controls?.querySelector('button');
    expect(howTo?.textContent).toContain('How to play');
    // The controls stack on mobile (flex-col) and reverse into a row from sm up (Play on the right).
    expect(controls?.className).toContain('flex-col');
    expect(controls?.className).toContain('sm:flex-row-reverse');
  });

  it('opens the rules sheet from an icon-free "How to play" control on this page (spec 0051)', () => {
    render(<InsiderHome viewer={viewer} surface={surface} />);
    // No dialog until a rules trigger is clicked.
    expect(screen.queryByRole('dialog')).toBeNull();
    // The rules trigger text on this page carries NO icon svg (showIcon={false}) - text only.
    const howToButtons = screen.getAllByRole('button', { name: /how to play/i });
    const teeterRules = howToButtons.find((b) =>
      /teeter tower/i.test(b.getAttribute('aria-label') ?? ''),
    );
    expect(teeterRules).toBeDefined();
    expect(teeterRules?.querySelector('svg')).toBeNull();
    // Clicking it opens the game's rules sheet.
    fireEvent.click(teeterRules as HTMLElement);
    expect(screen.getByRole('dialog')).toBeDefined();
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
