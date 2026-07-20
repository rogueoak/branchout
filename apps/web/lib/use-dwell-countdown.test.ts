import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDwellCountdown } from './use-dwell-countdown';

describe('useDwellCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns null when there is no dwell running', () => {
    const { result } = renderHook(() => useDwellCountdown(null, 'leaderboard', false));
    expect(result.current).toBeNull();
  });

  it('counts down whole seconds from the remaining dwell', () => {
    const { result } = renderHook(({ ms, phase, p }) => useDwellCountdown(ms, phase, p), {
      initialProps: { ms: 5_000, phase: 'leaderboard', p: false },
    });
    expect(result.current).toBe(5);
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(3);
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(0);
  });

  it('freezes the count while paused and does not tick', () => {
    const { result, rerender } = renderHook(({ ms, phase, p }) => useDwellCountdown(ms, phase, p), {
      initialProps: { ms: 5_000, phase: 'leaderboard', p: false },
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(3);
    // Pause: the frame carries the frozen remaining (3s) and paused=true.
    rerender({ ms: 3_000, phase: 'leaderboard', p: true });
    expect(result.current).toBe(3);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(3); // held, not ticking
  });

  it('re-anchors on a new PHASE even when the remaining value is unchanged (back-to-back dwells)', () => {
    // The reveal dwell then the leaderboard dwell can be the SAME length (both 5s). Keying on the
    // phase makes the second dwell restart from full rather than continue the first's deadline.
    const { result, rerender } = renderHook(({ ms, phase, p }) => useDwellCountdown(ms, phase, p), {
      initialProps: { ms: 5_000, phase: 'disputing', p: false },
    });
    act(() => vi.advanceTimersByTime(4_000));
    expect(result.current).toBe(1);
    // Same 5000ms remaining arrives, but the phase flipped to leaderboard: a fresh dwell.
    rerender({ ms: 5_000, phase: 'leaderboard', p: false });
    expect(result.current).toBe(5);
  });
});
