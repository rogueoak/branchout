import { describe, expect, it } from 'vitest';
import { countdownTone } from './countdown';

describe('countdownTone', () => {
  // Thresholds are a PERCENTAGE of the configured window: warning at <=30% left, danger at <=10%.
  it('is neutral above 30% of the window remaining', () => {
    // 60s window: 30% = 18s. 19s left is still neutral.
    expect(countdownTone(19, 60_000)).toBe('neutral');
    expect(countdownTone(60, 60_000)).toBe('neutral');
  });

  it('turns warning at or below 30% remaining', () => {
    // 60s window: 18s is exactly 30%.
    expect(countdownTone(18, 60_000)).toBe('warning');
    expect(countdownTone(10, 60_000)).toBe('warning');
  });

  it('turns danger at or below 10% remaining', () => {
    // 60s window: 6s is exactly 10%.
    expect(countdownTone(6, 60_000)).toBe('danger');
    expect(countdownTone(0, 60_000)).toBe('danger');
  });

  it('scales the thresholds to the configured window (20s limit)', () => {
    // 20s window: 30% = 6s, 10% = 2s.
    expect(countdownTone(7, 20_000)).toBe('neutral');
    expect(countdownTone(6, 20_000)).toBe('warning');
    expect(countdownTone(2, 20_000)).toBe('danger');
  });

  it('falls back to fixed second thresholds when the total is unknown', () => {
    expect(countdownTone(20, null)).toBe('neutral');
    expect(countdownTone(15, null)).toBe('warning');
    expect(countdownTone(5, null)).toBe('danger');
  });
});
