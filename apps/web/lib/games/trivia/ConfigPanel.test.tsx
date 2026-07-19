import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriviaConfigPanel } from './ConfigPanel';
import { defaultTriviaConfig, type TriviaHostConfig } from './config';

function renderPanel(overrides: Partial<TriviaHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <TriviaConfigPanel
      value={{ ...defaultTriviaConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('TriviaConfigPanel categories', () => {
  it('defaults to Random (empty selection)', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /^random/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('adds a category to the subset when a chip is tapped', () => {
    const onChange = renderPanel({ categories: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Science' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ categories: ['Science'] }));
  });

  it('ACCUMULATES onto a non-empty subset rather than overwriting it (multi-select)', () => {
    const onChange = renderPanel({ categories: ['Science'] });
    // Science is already selected; tapping Food must append, not replace.
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ['Science', 'Food'] }),
    );
  });

  it('removes just the tapped category from a multi-selection', () => {
    const onChange = renderPanel({ categories: ['Science', 'Food'] });
    fireEvent.click(screen.getByRole('button', { name: 'Science' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ categories: ['Food'] }));
  });

  it('removes a selected category and clears back to Random via the Random button', () => {
    const onChange = renderPanel({ categories: ['Science', 'Food'] });
    fireEvent.click(screen.getByRole('button', { name: /^random/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ categories: [] }));
  });
});

describe('TriviaConfigPanel rounds', () => {
  it('sets rounds from a preset', () => {
    const onChange = renderPanel({ rounds: 10 });
    fireEvent.click(screen.getByRole('radio', { name: /long/i }));
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

describe('TriviaConfigPanel difficulty', () => {
  it('renders label-only presets without exposing the 1-10 numbers', () => {
    const { container } = render(
      <TriviaConfigPanel value={defaultTriviaConfig()} onChange={vi.fn()} disabled={false} />,
    );
    // The default band (3-6) selects the Medium preset (matched by its description to avoid the
    // "Medium (20)" rounds preset).
    const medium = screen.getByRole('radio', { name: /a balanced mix/i });
    expect(medium.getAttribute('aria-checked')).toBe('true');
    // No slider and no raw range text like "3-6" leaks into the difficulty UI.
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(screen.queryByText(/3\s*-\s*6/)).toBeNull();
  });

  it('sets the band from a preset', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: /^hard/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ difficultyMin: 6, difficultyMax: 10 }),
    );
  });

  it('shows a read-only Custom option for a non-preset band (a legacy 4-6 room)', () => {
    renderPanel({ difficultyMin: 4, difficultyMax: 6 });
    const custom = screen.getByRole('radio', { name: /a custom difficulty range/i });
    expect(custom.getAttribute('aria-checked')).toBe('true');
  });
});
