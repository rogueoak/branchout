'use client';

// Reversi's host config panel (spec 0054). Reversi is fixed 8x8 standard rules with no options, so the
// panel is a short, honest note rather than a form. It still matches the generic GameConfigPanelProps
// so the lobby shell treats it like any other game.

import type { ComponentType } from 'react';
import type { GameConfigPanelProps } from '../registry';

export const ReversiConfigPanel: ComponentType<GameConfigPanelProps> =
  function ReversiConfigPanel() {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-text">Classic 8x8 Reversi for two players, no setup needed.</p>
        <p className="text-body-sm text-text-muted">
          Violet moves first. Place a disc to bracket a line of the other color and flip it. Start
          when both players have joined.
        </p>
      </div>
    );
  };
