import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BramblesConfigPanel } from './ConfigPanel';
import { defaultBramblesConfig } from './config';

describe('BramblesConfigPanel', () => {
  it('renders the defaults and reports a change', () => {
    const onChange = vi.fn();
    render(
      <BramblesConfigPanel value={defaultBramblesConfig()} onChange={onChange} disabled={false} />,
    );
    fireEvent.change(screen.getByLabelText(/sprints/i), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sprints: 8 }));
  });

  it('shows an error for an odd sprint count', () => {
    render(
      <BramblesConfigPanel
        value={{ sprints: 3, sprintSeconds: 60 }}
        onChange={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
