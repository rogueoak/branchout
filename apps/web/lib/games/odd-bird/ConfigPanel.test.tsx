import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OddBirdConfigPanel } from './ConfigPanel';
import { defaultOddBirdConfig } from './config';

describe('OddBirdConfigPanel', () => {
  it('defaults to Random and switches to a category pick', () => {
    const onChange = vi.fn();
    render(<OddBirdConfigPanel value={defaultOddBirdConfig()} onChange={onChange} />);
    expect(
      screen.getByRole('button', { name: /random \(all\)/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /pick categories/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0];
    expect(Array.isArray(next.categories)).toBe(true);
  });

  it('toggles a category on', () => {
    const onChange = vi.fn();
    render(<OddBirdConfigPanel value={{ categories: ['everyday'] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /travel/i }));
    expect(onChange).toHaveBeenCalledWith({ categories: ['everyday', 'travel'] });
  });
});
