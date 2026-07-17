'use client';

// Checkers's host config panel (spec 0055). Checkers is fixed 8x8 standard English draughts with no
// options, so the panel is a short, honest note rather than a form. It still matches the generic
// GameConfigPanelProps so the lobby shell treats it like any other game.

import type { ComponentType } from 'react';
import type { GameConfigPanelProps } from '../registry';

export const CheckersConfigPanel: ComponentType<GameConfigPanelProps> =
  function CheckersConfigPanel() {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-text">
          Classic 8x8 checkers (English draughts) for two players, no setup needed.
        </p>
        <p className="text-body-sm text-text-muted">
          Violet moves first. Move diagonally forward; jump to capture, and if a jump is available
          you must take it. Reach the far row to crown a King. Start when both players have joined.
        </p>
      </div>
    );
  };
