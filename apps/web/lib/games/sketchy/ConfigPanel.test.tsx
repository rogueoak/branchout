import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SketchyConfigPanel } from './ConfigPanel';
import { defaultSketchyConfig, type SketchyHostConfig } from './config';

function renderPanel(overrides: Partial<SketchyHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <SketchyConfigPanel
      value={{ ...defaultSketchyConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('SketchyConfigPanel rounds', () => {
  it('sets rounds from a preset', () => {
    const onChange = renderPanel({ rounds: 5 });
    fireEvent.click(screen.getByRole('radio', { name: /marathon/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 15 }));
  });

  it('reveals a custom number field when Custom is chosen', () => {
    renderPanel({ rounds: 5 });
    expect(screen.queryByLabelText(/custom rounds/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /set your own number of rounds/i }));
    expect(screen.getByLabelText(/custom rounds/i)).toBeDefined();
  });

  it('shows the custom field for a non-preset round count', () => {
    renderPanel({ rounds: 9 });
    expect(screen.getByLabelText(/custom rounds/i)).toBeDefined();
  });

  it('names presets cleanly (no bracketed count) with the count in the description (WS12)', () => {
    renderPanel({ rounds: 5 });
    expect(screen.queryByText('Fast (3)')).toBeNull();
    expect(screen.getByText('Fast')).toBeDefined();
    expect(screen.getByText('Marathon')).toBeDefined();
    expect(screen.getByText(/3 rounds/i)).toBeDefined();
    expect(screen.getByText(/15 rounds/i)).toBeDefined();
  });

  it('flags an out-of-range custom round count', () => {
    renderPanel({ rounds: 99 });
    expect(screen.getByRole('alert').textContent).toMatch(/rounds/i);
  });
});
