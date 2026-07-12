'use client';

// The visible move countdown (spec 0017). The engine sends the time *remaining* in each `state`
// frame (skew-proof); this hook anchors that to the local clock at receipt and ticks it down to a
// whole-second display. Anchoring - not trusting a raw remaining every render - lets the number
// fall smoothly between frames, and re-anchoring on a new frame, a new round, or a resume keeps it
// honest (a fresh round reuses the same 60000, and a pause/resume can resend the same remaining).

import { useEffect, useState } from 'react';

/**
 * Seconds left in the move window, or null when there is no timer. While paused it holds at the
 * frozen remaining (the engine stops the clock); otherwise it counts down to zero from the deadline.
 */
export function useMoveCountdown(
  moveMsRemaining: number | null,
  round: number,
  paused: boolean,
): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);

  // Re-anchor on a new frame value, a new round (same value, fresh window), or a resume.
  useEffect(() => {
    setDeadline(moveMsRemaining == null ? null : Date.now() + moveMsRemaining);
  }, [moveMsRemaining, round, paused]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline == null || paused) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadline, paused]);

  if (moveMsRemaining == null) return null;
  // Paused: the engine's clock is stopped, so show the frozen remaining, not the (stale) deadline.
  if (paused) return Math.ceil(moveMsRemaining / 1000);
  if (deadline == null) return Math.ceil(moveMsRemaining / 1000);
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
