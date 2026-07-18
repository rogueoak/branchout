import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '@rogueoak/canopy';
import { TopNav } from './TopNav';

// The account menu (signed-in) uses next/navigation's useRouter; stub it for jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('TopNav', () => {
  it('signed out: shows Games, a Log in link, and a single primary Sign up CTA', () => {
    render(<TopNav viewer={{ signedIn: false }} />);
    expect(screen.getByRole('link', { name: 'Games' })).toHaveProperty(
      'href',
      expect.stringContaining('/games'),
    );
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveProperty(
      'href',
      expect.stringContaining('/login'),
    );
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveProperty(
      'href',
      expect.stringContaining('/signup'),
    );
    // No account menu when signed out.
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
  });

  it('shows a Join link straight to /join for a signed-out player with a code (spec 0029)', () => {
    render(<TopNav viewer={{ signedIn: false }} />);
    expect(screen.getByRole('link', { name: 'Join' }).getAttribute('href')).toBe('/join');
  });

  it('shows the Join link for a signed-in viewer too (spec 0029)', () => {
    render(<TopNav viewer={{ signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat' }} />);
    expect(screen.getByRole('link', { name: 'Join' }).getAttribute('href')).toBe('/join');
  });

  it('keeps the Join link surface-owned (relative) on the insider surface (spec 0029)', () => {
    render(
      <TopNav
        viewer={{ signedIn: false }}
        label="Insider"
        linkOrigin="https://branchout.games"
        insider
      />,
    );
    const join = screen.getByRole('link', { name: 'Join' });
    // Relative so the insider middleware rewrites it into the insider join tree; never crossed to apex.
    expect(join.getAttribute('href')).toBe('/join');
    expect(join.getAttribute('href')).not.toContain('branchout.games');
  });

  it('signed in: replaces Log in / Sign up with the account avatar menu', () => {
    render(<TopNav viewer={{ signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat' }} />);
    expect(screen.getByRole('button', { name: /account menu for cat/i })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull();
    // Games stays for everyone.
    expect(screen.getByRole('link', { name: 'Games' })).toBeDefined();
  });

  it('falls back to the signed-out nav if a signed-in viewer carries no gamer tag', () => {
    render(<TopNav viewer={{ signedIn: true }} />);
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
  });

  it('Sign up is a primary CTA by default', () => {
    render(<TopNav viewer={{ signedIn: false }} />);
    expect(screen.getByRole('link', { name: 'Sign up' }).className).toBe(
      buttonVariants({ variant: 'primary', size: 'sm' }),
    );
  });

  it('signupVariant="outline" de-emphasizes the Sign up CTA (for a page whose hero owns the primary)', () => {
    render(<TopNav viewer={{ signedIn: false }} signupVariant="outline" />);
    expect(screen.getByRole('link', { name: 'Sign up' }).className).toBe(
      buttonVariants({ variant: 'outline', size: 'sm' }),
    );
  });

  it('renders a surface label pill when given one (the insider marker, spec 0035)', () => {
    render(
      <TopNav viewer={{ signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat' }} label="Insider" />,
    );
    expect(screen.getByText('Insider')).toBeDefined();
    // The account menu still renders alongside the label.
    expect(screen.getByRole('button', { name: /account menu for cat/i })).toBeDefined();
  });

  it('renders no surface label by default', () => {
    render(<TopNav viewer={{ signedIn: false }} />);
    expect(screen.queryByText('Insider')).toBeNull();
  });

  it('on the insider surface: Games and the wordmark stay on the host, apex-only links cross (feedback 0030)', () => {
    // The insider surface passes its apex origin (for the apex-only links) plus `insider` (so the
    // surface-owned home + Games links stay relative on the insider host, where the insider games
    // live on the landing).
    render(
      <TopNav
        viewer={{ signedIn: false }}
        label="Insider"
        linkOrigin="https://branchout.games"
        insider
      />,
    );
    // Surface-owned: Games points at the insider landing (relative `/`), NOT the apex public games.
    const games = screen.getByRole('link', { name: 'Games' });
    expect(games.getAttribute('href')).toBe('/');
    expect(games.getAttribute('href')).not.toContain('branchout.games');
    // Surface-owned: the wordmark/home points at the insider landing (relative `/`), not apex home.
    const home = screen.getByRole('link', { name: /branch out games home/i });
    expect(home.getAttribute('href')).toBe('/');
    // Apex-only: Log in / Sign up still cross to the apex origin (they have no insider page).
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
      'https://branchout.games/login',
    );
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
      'https://branchout.games/signup',
    );
  });

  it('on the apex: Games points at the public games index and home stays relative', () => {
    render(<TopNav viewer={{ signedIn: false }} />);
    expect(screen.getByRole('link', { name: 'Games' }).getAttribute('href')).toBe('/games');
    expect(screen.getByRole('link', { name: /branch out games home/i }).getAttribute('href')).toBe(
      '/',
    );
  });
});
