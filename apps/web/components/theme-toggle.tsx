'use client';

import { Button } from '@rogueoak/canopy';
import { useState } from 'react';

// Flips `.dark` on <html>, the single switch canopy reads to re-theme the whole UI (spec 0002).
// No per-component code: the token layer does the work.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  return (
    <Button
      variant="outline"
      onClick={() => {
        const next = document.documentElement.classList.toggle('dark');
        setDark(next);
      }}
    >
      {dark ? 'Light mode' : 'Dark mode'}
    </Button>
  );
}
