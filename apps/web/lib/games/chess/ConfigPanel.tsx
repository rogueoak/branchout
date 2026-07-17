'use client';

// Chess's host config panel (spec 0056). Chess is fixed standard rules with no options, so the panel is
// a short, honest note rather than a form. It still matches the generic GameConfigPanelProps so the
// lobby shell treats it like any other game.

import type { ComponentType } from 'react';
import type { GameConfigPanelProps } from '../registry';

export const ChessConfigPanel: ComponentType<GameConfigPanelProps> = function ChessConfigPanel() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-text">Classic chess for two players, no setup needed.</p>
      <p className="text-body-sm text-text-muted">
        Violet (White) moves first. Full standard rules - castling, en passant, and promotion all
        apply. Win by checkmate. Start when both players have joined.
      </p>
    </div>
  );
};
