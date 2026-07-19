import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriviaAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultTriviaConfig, type TriviaHostConfig } from './config';

function renderPanel(overrides: Partial<TriviaHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <TriviaAdvancedConfigPanel
      value={{ ...defaultTriviaConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('TriviaAdvancedConfigPanel', () => {
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
    const limit = screen.getByLabelText(/time limit/i);
    expect(limit.getAttribute('min')).toBe('10');
    expect(limit.getAttribute('max')).toBe('180');
  });

  it('edits the time limit', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText(/time limit/i), { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeLimitSeconds: 90 }));
  });

  it('flags an out-of-range value', () => {
    renderPanel({ timeLimitSeconds: 5 });
    expect(screen.getByRole('alert').textContent).toMatch(/time limit/i);
  });
});
