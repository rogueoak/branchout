import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The join surface carries the shared footer (spec 0031). Mock the router so JoinForm renders; it
// only calls room-api on submit, so a render test needs no other mocks.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { JoinForm } from './JoinForm';

describe('JoinForm', () => {
  it('renders the shared footer with privacy and terms links', () => {
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      expect.stringContaining('/privacy'),
    );
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveProperty(
      'href',
      expect.stringContaining('/terms'),
    );
  });
});
