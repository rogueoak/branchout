import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet';

// A tiny host that owns the open state, so a trigger click and Escape/close both flow through
// onOpenChange the way the real callers wire it.
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="How to play"
      trigger={<button type="button">Open rules</button>}
    >
      <p>The objective goes here.</p>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('opens on the trigger and exposes a modal dialog', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open rules' }));

    // getByRole('dialog') only matches an element with role="dialog"; Radix sets that plus the
    // focus trap and scroll lock, so the modal a11y is provided for us.
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    // The title labels the dialog (its accessible name), so a screen reader announces it.
    expect(screen.getByRole('dialog', { name: 'How to play' })).toBeDefined();
    expect(screen.getByText('The objective goes here.')).toBeDefined();
  });

  it('closes on the X close button', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open rules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open rules' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
