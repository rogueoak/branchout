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

  it('offers the two new categories (Movies, Music)', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Movies' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Music' })).toBeDefined();
  });

  it('adds a category to the subset when a chip is tapped', () => {
    const onChange = renderPanel({ categories: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Science' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ categories: ['Science'] }));
  });

  it('ACCUMULATES onto a non-empty subset rather than overwriting it (multi-select)', () => {
    const onChange = renderPanel({ categories: ['Science'] });
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

describe('TriviaConfigPanel duration', () => {
  it('sets the duration from a preset', () => {
    const onChange = renderPanel({ duration: 'standard' });
    // "Long" is unique to the duration selector (matched by its description line).
    fireEvent.click(screen.getByRole('radio', { name: /a longer game/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ duration: 'long' }));
  });

  it('names presets cleanly with the question count on the description line', () => {
    renderPanel({ duration: 'standard' });
    expect(screen.getByText('Fast')).toBeDefined();
    expect(screen.getByText('Marathon')).toBeDefined();
    // The count reads on the description, not bracketed into the name.
    expect(screen.getByText(/6 questions/i)).toBeDefined();
    expect(screen.getByText(/48 questions/i)).toBeDefined();
  });

  it('selecting Custom emits a custom duration seeded from the current preset mix', () => {
    const onChange = renderPanel({ duration: 'standard' });
    fireEvent.click(screen.getByRole('radio', { name: /set your own mix/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 'custom',
        custom: { multipleChoice: 6, trueFalse: 4, open: 2 },
      }),
    );
  });

  it('reveals three per-type count inputs when duration is custom', () => {
    renderPanel({ duration: 'custom', custom: { multipleChoice: 3, trueFalse: 2, open: 1 } });
    expect(screen.getByLabelText(/multiple choice/i)).toBeDefined();
    expect(screen.getByLabelText(/true or false/i)).toBeDefined();
    expect(screen.getByLabelText(/open answer/i)).toBeDefined();
  });

  it('carries the 0-30 bounds on each custom count input', () => {
    renderPanel({ duration: 'custom', custom: { multipleChoice: 3, trueFalse: 2, open: 1 } });
    const mc = screen.getByLabelText(/multiple choice/i);
    expect(mc.getAttribute('min')).toBe('0');
    expect(mc.getAttribute('max')).toBe('30');
  });

  it('edits a custom count', () => {
    const onChange = renderPanel({
      duration: 'custom',
      custom: { multipleChoice: 3, trueFalse: 2, open: 1 },
    });
    fireEvent.change(screen.getByLabelText(/multiple choice/i), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ custom: { multipleChoice: 5, trueFalse: 2, open: 1 } }),
    );
  });

  it('flags an invalid custom mix (all zeros)', () => {
    renderPanel({ duration: 'custom', custom: { multipleChoice: 0, trueFalse: 0, open: 0 } });
    expect(screen.getByRole('alert').textContent).toMatch(/total/i);
  });

  it('shows a live total for a valid custom mix', () => {
    renderPanel({ duration: 'custom', custom: { multipleChoice: 3, trueFalse: 2, open: 1 } });
    expect(screen.getByText(/6 questions total/i)).toBeDefined();
  });
});

describe('TriviaConfigPanel difficulty', () => {
  it('renders label-only presets without exposing the 1-10 numbers', () => {
    const { container } = render(
      <TriviaConfigPanel value={defaultTriviaConfig()} onChange={vi.fn()} disabled={false} />,
    );
    const medium = screen.getByRole('radio', { name: /a balanced mix/i });
    expect(medium.getAttribute('aria-checked')).toBe('true');
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
