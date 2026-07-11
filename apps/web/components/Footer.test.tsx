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
});
