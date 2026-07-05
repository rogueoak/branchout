import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('home page', () => {
  it('renders real canopy components (Button, Card, Badge, Input) in the Confetti theme', () => {
    render(<HomePage />);
    // `getByRole`/`getByText` already throw on a miss, so assert a concrete property of each
    // element - its type and the canopy semantic-token class it carries - not a hollow
    // `toBeDefined()` (the anti-pattern this PR flags in learnings.md).

    // Card title renders as a real heading with the roots h1 type token.
    expect(screen.getByRole('heading', { name: 'Branch out' }).className).toContain('text-h1');

    // Canopy Button (primary variant -> bg-primary), themed entirely by the token layer.
    const cta = screen.getByRole('button', { name: 'Start a room' });
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.className).toContain('bg-primary');

    // Canopy Input.
    expect(screen.getByRole('textbox', { name: 'Room code' }).tagName).toBe('INPUT');

    // Canopy Badge (success variant -> bg-success).
    expect(screen.getByText('Ready').className).toContain('bg-success');

    // The dark-mode toggle that flips `.dark` on <html>.
    expect(screen.getByRole('button', { name: 'Dark mode' }).tagName).toBe('BUTTON');
  });
});
