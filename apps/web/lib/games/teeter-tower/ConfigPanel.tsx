'use client';

// Teeter Tower's host config panel (spec 0043). Teeter takes no options yet - it starts on defaults
// and runs three fixed levels of stacking - so the panel is a short, honest note rather than a form.
// It still matches the generic GameConfigPanelProps so the lobby shell treats it like any other game.

import type { ComponentType } from 'react';
import type { GameConfigPanelProps } from '../registry';

// Teeter takes no host config, so the panel ignores its props entirely; typing it as the shared
// component type keeps it interchangeable with every other game's panel in the lobby shell.
export const TeeterConfigPanel: ComponentType<GameConfigPanelProps> = function TeeterConfigPanel() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-text">Three levels of stacking, no setup needed.</p>
      <p className="text-body-sm text-text-muted">
        Spin a googly-eyed piece, lock its angle, and drop it to build toward the target line. Start
        when you are ready.
      </p>
    </div>
  );
};
