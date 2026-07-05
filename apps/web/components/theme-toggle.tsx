'use client';

import { Button } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';

// Flips `.dark` on <html>, the single switch canopy reads to re-theme the whole UI (spec 0002).
// No per-component code: the token layer does the work. `<html>.dark` is the source of truth, so
// sync the initial label from it on mount - the server renders the light label to avoid a
// hydration mismatch, then this corrects it if the page already loaded in dark.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
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
