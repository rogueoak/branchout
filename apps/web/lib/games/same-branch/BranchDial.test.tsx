import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BranchDial } from './BranchDial';

describe('BranchDial', () => {
  it('renders the two branch ends and an ARIA slider', () => {
    render(<BranchDial left="cold" right="hot" value={40} ariaLabel="the branch" />);
    expect(screen.getByText('cold')).toBeDefined();
    expect(screen.getByText('hot')).toBeDefined();
    const slider = screen.getByRole('slider', { name: 'the branch' });
    expect(slider.getAttribute('aria-valuenow')).toBe('40');
    // The valuetext names the two ends so a screen reader conveys which way the value leans.
    expect(slider.getAttribute('aria-valuetext')).toBe('40 of 100, between cold and hot');
  });

  it('moves the sap line with the keyboard when interactive', () => {
    const onChange = vi.fn();
    render(
      <BranchDial left="cold" right="hot" value={50} onChange={onChange} ariaLabel="move it" />,
    );
    const slider = screen.getByRole('slider', { name: 'move it' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(51);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith(0);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('is not focusable or keyboard-driven when read-only', () => {
    const onChange = vi.fn();
    render(<BranchDial left="cold" right="hot" value={20} ariaLabel="read only" />);
    const slider = screen.getByRole('slider', { name: 'read only' });
    expect(slider.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a null value as an unset prompt', () => {
    render(
      <BranchDial left="cold" right="hot" value={null} onChange={() => {}} ariaLabel="unset" />,
    );
    expect(screen.getByText(/drag the sap line/i)).toBeDefined();
  });
});
