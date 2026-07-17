import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HowToPlayButton } from './HowToPlayButton';

// The unified "How to play" control (spec 0051), exercised for the insider surface: teeter-tower is
// the insider game and has a real catalog + library entry, so it stands in for the insider index's
// per-card rules trigger. Coverage the insider flow otherwise lacked (only the in-game GameStage was
// tested before): it renders, opens the sheet showing the objective, and null-guards an unknown id.

describe('HowToPlayButton', () => {
  it('renders a rules trigger for a real (insider) game', () => {
    render(<HowToPlayButton game="teeter-tower" />);
    expect(screen.getByRole('button', { name: /how to play/i })).toBeDefined();
  });

  it('opens the sheet showing the game objective', () => {
    render(<HowToPlayButton game="teeter-tower" />);
    // No dialog until the trigger is clicked.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /how to play/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    // Teeter Tower's objective (from the library rules) is shown in the sheet body.
    expect(screen.getByText(/stack pieces to reach the target line/i)).toBeDefined();
  });

  it('renders nothing for an unknown game id', () => {
    const { container } = render(<HowToPlayButton game="not-a-real-game" />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole('button', { name: /how to play/i })).toBeNull();
  });

  it('is NOT nested inside a play link (stays its own control)', () => {
    // The insider card wraps the play affordance in an <a>; this trigger must sit OUTSIDE that link
    // (interactive-in-interactive is an a11y violation). Here it renders standalone, so the button
    // has no ancestor <a>.
    render(<HowToPlayButton game="teeter-tower" />);
    const button = screen.getByRole('button', { name: /how to play/i });
    expect(button.closest('a')).toBeNull();
  });
});
