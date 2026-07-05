import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('home page', () => {
  it('renders real canopy components (Button, Card, Badge, Input) in the Confetti theme', () => {
    render(<HomePage />);
    // Card title renders as a heading.
    expect(screen.getByRole('heading', { name: 'Branch out' })).toBeDefined();
    // Canopy Button, themed by the token layer with no per-component overrides.
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeDefined();
    // Canopy Input.
    expect(screen.getByRole('textbox', { name: 'Room code' })).toBeDefined();
    // Canopy Badge.
    expect(screen.getByText('Ready')).toBeDefined();
    // The dark-mode toggle that flips `.dark` on <html>.
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeDefined();
  });
});
