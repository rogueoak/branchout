import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComingSoonBanner } from './ComingSoonBanner';

describe('ComingSoonBanner (spec 0047)', () => {
  it('renders the coming-soon heading and a Subscribe-for-updates button', () => {
    render(<ComingSoonBanner />);
    expect(screen.getByRole('heading', { name: /more games coming soon/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /subscribe for updates/i })).toBeDefined();
    // The form is hidden until the button is clicked.
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it('reveals the subscribe form when the button is clicked', () => {
    render(<ComingSoonBanner />);
    fireEvent.click(screen.getByRole('button', { name: /subscribe for updates/i }));
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeDefined();
  });
});
