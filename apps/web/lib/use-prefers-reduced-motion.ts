'use client';

// Whether the viewer asked the OS to reduce motion (spec 0069). Any animation the UI adds for
// delight (the in-round countdown blink, and more later) gates on this so a motion-sensitive player
// gets a still, honest screen. Resolved on mount (SSR has no `matchMedia`) and kept live if the OS
// setting flips mid-game. Mirrors the inline pattern the Reversi viewer already uses, extracted so
// every surface shares one hook.

import { useEffect, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
