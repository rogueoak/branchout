import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckersAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultCheckersConfig } from './config';

// The advanced panel is form-only and controlled (spec 0071): it renders the "See available moves"
// toggle from the passed config and reports every flip through onChange. The parent owns the value.

describe('CheckersAdvancedConfigPanel', () => {
  it('renders the See available moves toggle ON by default', () => {
    render(<CheckersAdvancedConfigPanel value={defaultCheckersConfig()} onChange={() => {}} />);
    const toggle = screen.getByRole('switch', { name: /see available moves/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('reports the setting turned off when the host flips it', () => {
    const onChange = vi.fn();
    render(<CheckersAdvancedConfigPanel value={defaultCheckersConfig()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /see available moves/i }));
    expect(onChange).toHaveBeenCalledWith({ showAvailableMoves: false });
  });

  it('reflects an off value and flips back on', () => {
    const onChange = vi.fn();
    render(
      <CheckersAdvancedConfigPanel value={{ showAvailableMoves: false }} onChange={onChange} />,
    );
    const toggle = screen.getByRole('switch', { name: /see available moves/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ showAvailableMoves: true });
  });

  it('disables the toggle while the game is starting', () => {
    render(
      <CheckersAdvancedConfigPanel value={defaultCheckersConfig()} onChange={() => {}} disabled />,
    );
    expect(
      screen.getByRole('switch', { name: /see available moves/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
