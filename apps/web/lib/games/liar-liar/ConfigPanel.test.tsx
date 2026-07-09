import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiarLiarConfigPanel } from './ConfigPanel';
import { defaultLiarLiarConfig, type LiarLiarHostConfig } from './config';

describe('LiarLiarConfigPanel', () => {
  it('starts on Random and switches to a category selection', () => {
    const onChange = vi.fn();
    render(<LiarLiarConfigPanel value={defaultLiarLiarConfig()} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /random/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /pick categories/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]?.[0] as LiarLiarHostConfig;
    expect(Array.isArray(next.categories)).toBe(true);
  });

  it('caps the selection at three categories', () => {
    const config: LiarLiarHostConfig = { categories: ['people', 'food', 'sports'], rounds: 10 };
    render(<LiarLiarConfigPanel value={config} onChange={vi.fn()} />);
    expect(screen.getByText('3/3 chosen. Pick 1-3 categories, or switch to Random.')).toBeDefined();
    // An unchosen category is disabled once three are picked.
    expect((screen.getByRole('button', { name: 'Nature' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // A chosen one stays enabled so it can be removed.
    expect((screen.getByRole('button', { name: 'People' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('emits a changed round count', () => {
    const onChange = vi.fn();
    render(<LiarLiarConfigPanel value={defaultLiarLiarConfig()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/rounds/i), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 5 }));
  });
});
