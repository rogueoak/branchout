import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriviaAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultTriviaConfig, type TriviaHostConfig } from './config';

function renderPanel(overrides: Partial<TriviaHostConfig> = {}) {
  const onChange = vi.fn();
  render(
    <TriviaAdvancedConfigPanel
      value={{ ...defaultTriviaConfig(), ...overrides }}
      onChange={onChange}
      disabled={false}
    />,
  );
  return onChange;
}

describe('TriviaAdvancedConfigPanel', () => {
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

  it('carries the min/max bounds on the advance-after field', () => {
    renderPanel();
    const advance = screen.getByLabelText(/advance after/i);
    expect(advance.getAttribute('min')).toBe('1');
    expect(advance.getAttribute('max')).toBe('60');
  });

  it('renders three per-type timer fields with their own bounds and defaults', () => {
    renderPanel();
    const mc = screen.getByLabelText(/multiple choice/i) as HTMLInputElement;
    expect(mc.value).toBe('20');
    expect(mc.getAttribute('min')).toBe('5');
    expect(mc.getAttribute('max')).toBe('180');

    const tf = screen.getByLabelText(/true or false/i) as HTMLInputElement;
    expect(tf.value).toBe('15');
    expect(tf.getAttribute('min')).toBe('5');
    expect(tf.getAttribute('max')).toBe('180');

    const open = screen.getByLabelText(/open answer/i) as HTMLInputElement;
    expect(open.value).toBe('60');
    expect(open.getAttribute('min')).toBe('10');
    expect(open.getAttribute('max')).toBe('180');
  });

  it('edits each per-type time limit', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText(/multiple choice/i), { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mcTimeLimitSeconds: 30 }));
    fireEvent.change(screen.getByLabelText(/true or false/i), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tfTimeLimitSeconds: 25 }));
    fireEvent.change(screen.getByLabelText(/open answer/i), { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ openTimeLimitSeconds: 90 }));
  });

  it('flags an out-of-range multiple-choice time limit', () => {
    renderPanel({ mcTimeLimitSeconds: 4 });
    expect(screen.getByRole('alert').textContent).toMatch(/multiple-choice time limit/i);
  });

  it('flags an out-of-range open-answer time limit', () => {
    renderPanel({ openTimeLimitSeconds: 9 });
    expect(screen.getByRole('alert').textContent).toMatch(/open-answer time limit/i);
  });
});
