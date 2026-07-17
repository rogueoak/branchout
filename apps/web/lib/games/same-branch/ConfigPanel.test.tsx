import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SameBranchConfigPanel } from './ConfigPanel';
import { defaultSameBranchConfig } from './config';

describe('SameBranchConfigPanel', () => {
  it('toggles the scoring mode', () => {
    const onChange = vi.fn();
    render(
      <SameBranchConfigPanel
        value={defaultSameBranchConfig()}
        onChange={onChange}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /co-op/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'coop' }));
  });

  it('switches to picking categories', () => {
    const onChange = vi.fn();
    render(
      <SameBranchConfigPanel
        value={defaultSameBranchConfig()}
        onChange={onChange}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pick categories/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ categories: expect.arrayContaining(['senses']) }),
    );
  });

  it('surfaces a rounds error', () => {
    render(
      <SameBranchConfigPanel
        value={{ categories: 'random', rounds: 0, mode: 'free' }}
        onChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Rounds/);
  });
});
