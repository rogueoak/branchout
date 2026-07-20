'use client';

// The auto-advance dwell countdown (spec 0069): the "continuing in x" on the reveal screen and the
// "next round in x" on the leaderboard. The engine sends the time *remaining* in the current dwell
// (`autoAdvanceMsRemaining`, skew-proof) on each `state` frame; this hook anchors it to the local
// clock at receipt and ticks it down to whole seconds, exactly like `useMoveCountdown` does for the
// answer window.
//
// It re-anchors on the PHASE, not the round: two equal-length dwells run back to back within one
// round (the reveal dwell, then the leaderboard dwell), so keying on the round would let the second
// dwell keep counting from the first's deadline. A new phase = a fresh dwell = a fresh anchor.

import { useEffect, useState } from 'react';

export function useDwellCountdown(
  msRemaining: number | null,
  phase: string,
  paused: boolean,
): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);

  useEffect(() => {
    setDeadline(msRemaining == null ? null : Date.now() + msRemaining);
  }, [msRemaining, phase, paused]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline == null || paused) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadline, paused]);

  if (msRemaining == null) return null;
  // Paused: the engine's clock is stopped, so show the frozen remaining, not the stale deadline.
  if (paused) return Math.ceil(msRemaining / 1000);
  if (deadline == null) return Math.ceil(msRemaining / 1000);
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
