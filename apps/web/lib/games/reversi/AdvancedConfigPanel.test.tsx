import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReversiAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultReversiConfig } from './config';

// The advanced panel is form-only and controlled (WS8-config): it renders the "See available moves"
// toggle from the passed config and reports every flip through onChange. The parent owns the value.

describe('ReversiAdvancedConfigPanel', () => {
  it('renders the See available moves toggle ON by default', () => {
    render(<ReversiAdvancedConfigPanel value={defaultReversiConfig()} onChange={() => {}} />);
    const toggle = screen.getByRole('switch', { name: /see available moves/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('reports the setting turned off when the host flips it', () => {
    const onChange = vi.fn();
    render(<ReversiAdvancedConfigPanel value={defaultReversiConfig()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /see available moves/i }));
    expect(onChange).toHaveBeenCalledWith({ showAvailableMoves: false });
  });

  it('reflects an off value and flips back on', () => {
    const onChange = vi.fn();
    render(
      <ReversiAdvancedConfigPanel value={{ showAvailableMoves: false }} onChange={onChange} />,
    );
    const toggle = screen.getByRole('switch', { name: /see available moves/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ showAvailableMoves: true });
  });

  it('disables the toggle while the game is starting', () => {
    render(
      <ReversiAdvancedConfigPanel value={defaultReversiConfig()} onChange={() => {}} disabled />,
    );
    expect(
      screen.getByRole('switch', { name: /see available moves/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
