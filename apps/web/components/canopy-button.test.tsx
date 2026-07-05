import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanopyButton } from './canopy-button';

describe('CanopyButton placeholder', () => {
  it('renders its label as an accessible button carrying its design-system styling', () => {
    render(<CanopyButton>Start a room</CanopyButton>);
    const button = screen.getByRole('button', { name: 'Start a room' });
    // Proves the Tailwind-styled "design-system" surface, not just that an element exists.
    expect(button.className).toContain('bg-violet-600');
  });

  it('invokes onClick when pressed', async () => {
    let clicked = false;
    render(<CanopyButton onClick={() => (clicked = true)}>Start a room</CanopyButton>);
    screen.getByRole('button', { name: 'Start a room' }).click();
    expect(clicked).toBe(true);
  });
});
