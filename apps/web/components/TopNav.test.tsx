import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
