import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './Footer';

describe('Footer', () => {
  it('renders a footer landmark', () => {
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('links to the privacy policy and the terms of service', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      expect.stringContaining('/privacy'),
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveProperty(
      'href',
      expect.stringContaining('/terms'),
    );
  });

  it('crosses the legal links to the apex when given a linkOrigin (spec 0035)', () => {
    // On the insider subdomain, a relative /privacy would rewrite into the insider tree and 404,
    // so the surface passes its apex origin and the links become absolute.
    render(<Footer linkOrigin="https://branchout.games" />);
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      'https://branchout.games/privacy',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveProperty(
      'href',
      'https://branchout.games/terms',
    );
  });
});
