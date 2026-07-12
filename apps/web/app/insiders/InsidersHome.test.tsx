import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsidersHome } from './InsidersHome';

// The account menu (signed-in nav) uses next/navigation's useRouter; stub it for jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('InsidersHome (spec 0035)', () => {
  const viewer = { signedIn: true, gamerTag: 'CoolCat', nickname: 'Cat', insider: true };

  it('renders the Insiders heading and the nav surface label', () => {
    render(<InsidersHome viewer={viewer} />);
    // The page heading plus the nav badge both read "Insiders" (heading + label pill).
    expect(screen.getByRole('heading', { name: 'Insiders' })).toBeDefined();
    expect(screen.getAllByText('Insiders').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an intentional empty state while no test games are live', () => {
    render(<InsidersHome viewer={viewer} />);
    expect(screen.getByText(/no test games yet/i)).toBeDefined();
  });

  it('renders the shared account menu (main site look and feel)', () => {
    render(<InsidersHome viewer={viewer} />);
    expect(screen.getByRole('button', { name: /account menu for cat/i })).toBeDefined();
  });
});
