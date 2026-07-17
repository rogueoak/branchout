import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZingerConfigPanel } from './ConfigPanel';
import { defaultZingerConfig } from './config';

describe('ZingerConfigPanel', () => {
  it('emits a changed round count', () => {
    const onChange = vi.fn();
    render(<ZingerConfigPanel value={defaultZingerConfig()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/rounds/i), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 5 }));
  });

  it('shows the rounds error surface for an out-of-range value', () => {
    render(<ZingerConfigPanel value={{ rounds: 0 }} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('disables the input when disabled', () => {
    render(<ZingerConfigPanel value={defaultZingerConfig()} onChange={vi.fn()} disabled />);
    expect((screen.getByLabelText(/rounds/i) as HTMLInputElement).disabled).toBe(true);
  });
});
