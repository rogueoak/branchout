'use client';

// PLACEHOLDER for @rogueoak/canopy's Button. The real canopy design system and the Branch out
// Confetti theme land in spec 0002; until then this stand-in proves the web app renders a
// styled "design-system" component through Tailwind v4. Swap this file for the canopy import
// in 0002.
import type { ReactNode } from 'react';

export interface CanopyButtonProps {
  children: ReactNode;
  onClick?: () => void;
}

export function CanopyButton({ children, onClick }: CanopyButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white transition-colors hover:bg-violet-500"
    >
      {children}
    </button>
  );
}
