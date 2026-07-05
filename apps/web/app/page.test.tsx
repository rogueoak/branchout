import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('home page', () => {
  it('renders the placeholder home page with a canopy-style component', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Branch out' })).toBeDefined();
    // Acceptance 4: a placeholder page styled with a canopy component.
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeDefined();
  });
});
