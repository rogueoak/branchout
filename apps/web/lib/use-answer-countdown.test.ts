import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnswerCountdown } from './use-answer-countdown';

describe('useAnswerCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns null when there is no answer timer', () => {
    const { result } = renderHook(() => useAnswerCountdown(null, 1, false));
    expect(result.current).toBeNull();
  });

  it('counts down whole seconds from the remaining time', () => {
    const { result } = renderHook(({ ms, r, p }) => useAnswerCountdown(ms, r, p), {
      initialProps: { ms: 60_000, r: 1, p: false },
    });
    expect(result.current).toBe(60);
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(57);
    act(() => vi.advanceTimersByTime(57_000));
    expect(result.current).toBe(0);
  });

  it('holds the count while paused and does not tick', () => {
    const { result, rerender } = renderHook(({ ms, r, p }) => useAnswerCountdown(ms, r, p), {
      initialProps: { ms: 60_000, r: 1, p: false },
    });
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current).toBe(40);
    // Pause: the frame carries the frozen remaining (40s) and paused=true.
    rerender({ ms: 40_000, r: 1, p: true });
    expect(result.current).toBe(40);
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(40); // held, not ticking
    // Resume from the same 40s (the engine resends it): the countdown continues, not a fresh 60.
    rerender({ ms: 40_000, r: 1, p: false });
    expect(result.current).toBe(40);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(35);
  });

  it('re-anchors on a new round even when the remaining value is unchanged', () => {
    const { result, rerender } = renderHook(({ ms, r, p }) => useAnswerCountdown(ms, r, p), {
      initialProps: { ms: 60_000, r: 1, p: false },
    });
    act(() => vi.advanceTimersByTime(50_000));
    expect(result.current).toBe(10);
    rerender({ ms: 60_000, r: 2, p: false }); // next round reuses 60000
    expect(result.current).toBe(60);
  });
});
