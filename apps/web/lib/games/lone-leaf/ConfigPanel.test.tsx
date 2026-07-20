import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoneLeafConfigPanel } from './ConfigPanel';
import { defaultLoneLeafConfig, type LoneLeafHostConfig } from './config';

function renderPanel(overrides: Partial<LoneLeafHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <LoneLeafConfigPanel
      value={{ ...defaultLoneLeafConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('LoneLeafConfigPanel rounds presets', () => {
  it('selects the Standard preset (10) by default', () => {
    renderPanel({ rounds: 10 });
    const standard = screen.getByRole('radio', { name: /standard/i });
    expect(standard.getAttribute('aria-checked')).toBe('true');
  });

  it('sets rounds from a preset', () => {
    const onChange = renderPanel({ rounds: 10 });
    fireEvent.click(screen.getByRole('radio', { name: /marathon/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 40 }));
  });

  it('reveals a custom number field when Custom is chosen', () => {
    renderPanel({ rounds: 10 });
    expect(screen.queryByLabelText(/custom rounds/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /set your own number of rounds/i }));
    expect(screen.getByLabelText(/custom rounds/i)).toBeDefined();
  });

  it('shows the custom field for a non-preset round count', () => {
    renderPanel({ rounds: 13 });
    expect(screen.getByLabelText(/custom rounds/i)).toBeDefined();
  });
});
