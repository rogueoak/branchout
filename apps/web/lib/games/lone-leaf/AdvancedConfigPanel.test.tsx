import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoneLeafAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultLoneLeafConfig, type LoneLeafHostConfig } from './config';

function renderPanel(overrides: Partial<LoneLeafHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <LoneLeafAdvancedConfigPanel
      value={{ ...defaultLoneLeafConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('LoneLeafAdvancedConfigPanel', () => {
  it('shows auto-advance on by default and toggles it off', () => {
    const onChange = renderPanel();
    const toggle = screen.getByRole('switch', { name: /auto advance/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoAdvance: false }));
  });

  it('disables the advance-after field when auto-advance is off', () => {
    renderPanel({ autoAdvance: false });
    expect((screen.getByLabelText(/advance after/i) as HTMLInputElement).disabled).toBe(true);
  });

  it('carries the min/max bounds on the number inputs', () => {
    renderPanel();
    const advance = screen.getByLabelText(/advance after/i);
    expect(advance.getAttribute('min')).toBe('1');
    expect(advance.getAttribute('max')).toBe('60');
    const clue = screen.getByLabelText(/clue time/i);
    expect(clue.getAttribute('min')).toBe('15');
    expect(clue.getAttribute('max')).toBe('180');
    const guess = screen.getByLabelText(/guess time/i);
    expect(guess.getAttribute('min')).toBe('15');
    expect(guess.getAttribute('max')).toBe('180');
  });

  it('edits the clue and guess windows', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText(/clue time/i), { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ clueSeconds: 45 }));
    fireEvent.change(screen.getByLabelText(/guess time/i), { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ guessSeconds: 90 }));
  });

  it('flags an out-of-range window value', () => {
    renderPanel({ clueSeconds: 5 });
    expect(screen.getByRole('alert').textContent).toMatch(/clue time/i);
  });
});
