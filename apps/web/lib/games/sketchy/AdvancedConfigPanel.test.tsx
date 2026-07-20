import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SketchyAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultSketchyConfig, type SketchyHostConfig } from './config';

function renderPanel(overrides: Partial<SketchyHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <SketchyAdvancedConfigPanel
      value={{ ...defaultSketchyConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('SketchyAdvancedConfigPanel', () => {
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

  it('carries the min/max bounds on the advance-after input', () => {
    renderPanel();
    const advance = screen.getByLabelText(/advance after/i);
    expect(advance.getAttribute('min')).toBe('1');
    expect(advance.getAttribute('max')).toBe('60');
  });

  it('edits the advance-after dwell', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText(/advance after/i), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ advanceAfterSeconds: 8 }));
  });

  it('flags an out-of-range value', () => {
    renderPanel({ advanceAfterSeconds: 0 });
    expect(screen.getByRole('alert').textContent).toMatch(/advance after/i);
  });
});
